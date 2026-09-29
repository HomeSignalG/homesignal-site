// DURABLE REPORT SNAPSHOTS — the engine-agnostic module (Development Activity plan, Order F).
// supabase/functions/_shared/report-snapshot.ts turns assembled report content into a stored
// snapshot with two different identifiers. The database half is proven in test/report_snapshot_pg.
// This file proves the half that runs in the edge function, against a stand-in database that
// enforces the same rule the real one does (content_hash = sha256(body), the id is minted there).
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

const S = await import('../supabase/functions/_shared/report-snapshot.ts');
const API = await import('../supabase/functions/get-future-surroundings-report/allowlist.ts');
const V1 = require('../lib/nyc-v1-report.js');

// ── a stand-in for the database writer: the same three rules public.report_snapshot enforces ─────────────
function fakeDb() {
  const rows = [];
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn !== 'report_snapshot_issue') return { data: null, error: { message: 'unknown function ' + fn } };
    if (sha(args.p_body) !== args.p_content_hash) return { data: null, error: { message: 'report_snapshot_hash_matches_body' } };
    const row = { report_id: randomUUID(), generated_at: new Date().toISOString(), ...args };
    rows.push(row);
    return { data: [{ report_id: row.report_id, generated_at: row.generated_at }], error: null };
  };
  return { rows, calls, rpc };
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

// ── 1. content_hash IS the old fingerprint: the deterministic concept is retained, not replaced ────────────────
const apiReport = await API.assembleReport(input());
const pageReport = await V1.assembleReport(input());
const hash = await S.contentHashOf(apiReport);
ok(/^[0-9a-f]{64}$/.test(hash), '1a content_hash is a SHA-256 hex string');
ok(hash === apiReport.report_id,
  '1b for the NYC engine it equals the fingerprint that engine has always printed as report_id (the concept is retained, not changed)', { hash, legacy: apiReport.report_id });
ok(hash === pageReport.report_id && await S.contentHashOf(pageReport) === pageReport.report_id,
  '1c and the legacy page engine agrees, so the page, the API and the snapshot layer fingerprint the same data identically');
const body = S.snapshotBodyOf(apiReport);
const parsedBody = JSON.parse(body);
ok(!('report_id' in parsedBody) && !('generated_at' in parsedBody) && !('content_hash' in parsedBody),
  '1d the stored body carries none of the identity fields: content is hashed, identity is not');
ok(sha(body) === hash, '1e the hash is exactly the SHA-256 of the stored body text, so the database can check it');
ok(await S.contentHashOf(await API.assembleReport(input({ generated_at: '2027-01-01T00:00:00.000Z' }))) === hash,
  '1f unchanged data issued later has the same content_hash (so it is a fingerprint, and cannot be an issuance id)');
ok(await S.contentHashOf(await API.assembleReport(input({ issuance: [] }))) !== hash,
  '1g a record leaving the radius changes the content_hash');
ok(await S.contentHashOf({ ...apiReport, report_id: 'attacker', content_hash: 'attacker' }) === hash,
  '1h fields a caller puts in the identity slots do not change the content_hash');

// ── 2. issuing: two identifiers, minted by the database ─────────────────────────────────────────────────────────
const db = fakeDb();
const opts = { reportVersion: 'nyc-v1', inputs: { address: '1 Centre Street', zip: '10007', radius_mi: 0.5 }, propertyKey: 'nyc:1001387' };
const e1 = await S.issueSnapshot(db.rpc, apiReport, opts);
ok(e1.report_id === db.rows[0].report_id && /^[0-9a-f-]{36}$/.test(e1.report_id),
  '2a the report_id in the envelope is the one the database minted');
ok(e1.report_id !== e1.content_hash && e1.report_id !== apiReport.report_id,
  '2b report_id is not the content fingerprint: the two meanings are separated');
ok(e1.content_hash === hash && e1.report_version === 'nyc-v1' && e1.generated_at === db.rows[0].generated_at,
  '2c the envelope carries content_hash, report_version and the database\'s generated_at');
ok(JSON.stringify(e1.report) === body && JSON.stringify(e1.report) === db.rows[0].p_body,
  '2d the returned report is the stored text, byte for byte');
const e2 = await S.issueSnapshot(db.rpc, apiReport, opts);
ok(e2.report_id !== e1.report_id && e2.content_hash === e1.content_hash && db.rows.length === 2,
  '2e the same content issued twice is two snapshots: two report_ids, one content_hash');
const a = db.calls[0].args;
ok(JSON.stringify(Object.keys(a)) === JSON.stringify(['p_body', 'p_content_hash', 'p_report_version', 'p_inputs', 'p_property_key'])
   && db.calls.every((c) => c.fn === 'report_snapshot_issue'),
  '2f the module calls the one writer with exactly five named arguments, and none of them is an id or a timestamp', Object.keys(a));
const e3 = await S.issueSnapshot(db.rpc, { ...apiReport, report_id: 'attacker-chosen' }, { ...opts, propertyKey: undefined });
ok(e3.report_id !== 'attacker-chosen' && db.rows[2].p_property_key === null && !db.rows[2].p_body.includes('attacker-chosen'),
  '2g an id supplied inside the report is never used and never stored; an absent property key is stored as null');

// ── 3. verifying what was delivered ─────────────────────────────────────────────────────────────────────────────────
ok(await S.envelopeMatchesItsHash(e1) === true, '3a an envelope as delivered matches its content_hash');
const tampered = JSON.parse(JSON.stringify(e1));
tampered.report.nearby = [];
ok(await S.envelopeMatchesItsHash(tampered) === false, '3b an edited report no longer matches');
ok(await S.envelopeMatchesItsHash({ ...e1, content_hash: 'x' }) === false && await S.envelopeMatchesItsHash(null) === false,
  '3c a wrong hash and a missing envelope do not match');

// ── 4. fail closed: no envelope without a stored row ─────────────────────────────────────────────────────────────
const calls0 = db.calls.length;
const refusals = {
  'a database error': await throws(() => S.issueSnapshot(async () => ({ data: null, error: { message: 'boom' } }), apiReport, opts)),
  'no row': await throws(() => S.issueSnapshot(async () => ({ data: [], error: null }), apiReport, opts)),
  'two rows': await throws(() => S.issueSnapshot(async () => ({ data: [{ report_id: randomUUID(), generated_at: new Date().toISOString() }, { report_id: randomUUID(), generated_at: new Date().toISOString() }], error: null }), apiReport, opts)),
  'a malformed id': await throws(() => S.issueSnapshot(async () => ({ data: [{ report_id: 'not-a-uuid', generated_at: new Date().toISOString() }], error: null }), apiReport, opts)),
  'a content hash used as the id': await throws(() => S.issueSnapshot(async () => ({ data: [{ report_id: hash, generated_at: new Date().toISOString() }], error: null }), apiReport, opts)),
  'no generated_at': await throws(() => S.issueSnapshot(async () => ({ data: [{ report_id: randomUUID() }], error: null }), apiReport, opts)),
};
ok(/boom/.test(refusals['a database error']),
  '4a1 a database error is surfaced with the database\'s own message, not swallowed into a generic one', refusals['a database error']);
const errAndRow = await throws(() => S.issueSnapshot(
  async () => ({ data: [{ report_id: randomUUID(), generated_at: new Date().toISOString() }], error: { message: 'late failure' } }), apiReport, opts));
ok(typeof errAndRow === 'string' && /late failure/.test(errAndRow),
  '4a2 an error wins even when a well-formed row came back beside it: nothing is returned', errAndRow);
ok(Object.values(refusals).every((m) => typeof m === 'string' && /issueSnapshot/.test(m)),
  '4a a database error, no row, two rows, a malformed id, a hash in the id slot and a missing time each throw — no envelope is ever built', refusals);
const badIn = {
  'an empty version': await throws(() => S.issueSnapshot(db.rpc, apiReport, { ...opts, reportVersion: '  ' })),
  'array inputs': await throws(() => S.issueSnapshot(db.rpc, apiReport, { ...opts, inputs: [] })),
  'an array report': await throws(() => S.issueSnapshot(db.rpc, [], opts)),
  'a null report': await throws(() => S.issueSnapshot(db.rpc, null, opts)),
};
ok(Object.values(badIn).every((m) => typeof m === 'string') && db.calls.length === calls0,
  '4b invalid input throws BEFORE the database is called', badIn);

// ── 5. the module cannot reach anything but the rpc it is handed ─────────────────────────────────────────────────────
const SRC = read('supabase/functions/_shared/report-snapshot.ts');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');
ok(!/^\s*import\b/m.test(CODE) && !/\brequire\s*\(/.test(CODE),
  '5a the module imports nothing: no client library, no other module');
ok(!/Deno\.env|process\.env|\bfetch\s*\(|createClient|SUPABASE_/.test(CODE),
  '5b it reads no environment, makes no request and holds no credential');
ok(!/randomUUID|gen_random_uuid|Math\.random|crypto\.getRandomValues/.test(CODE),
  '5c it mints no identifier of any kind: the report_id can only come from the database');
ok(!/\b(nyc|new york|manhattan|brooklyn|queens|bronx|staten|socrata|dob|tucson|phoenix|denver)\b/i.test(CODE),
  '5d it names no city, market or source: it is engine-agnostic');
ok((CODE.match(/rpc\(/g) || []).length === 1 && /rpc\('report_snapshot_issue'/.test(CODE),
  '5e it makes exactly one database call, to the one writer');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
