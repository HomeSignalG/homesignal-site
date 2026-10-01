// ECHO / CWA CALLS MUST REPORT WHAT HAPPENED, AND A FAILED CALL MUST NOT WIPE STORED DATA.
//
// WHY THIS FILE EXISTS. echoEnrich / cwaPermitEnrich used to `return` on a non-200 or
// timeout with no stamp. The refresh then wrote FRS facilities without env.epa, which
// looks identical to "EPA answered and matched nothing" and overwrites last-known-good
// compliance data (audit 2026-09-27: 01610 = 40 FRS, 0 ECHO, 2 CWA). The FRS guard
// (epa.ok) does not see this. The shipped module now returns an outcome and
// preserveStoredEnv copies stored env.epa back when ok:false.
//
// Driven against sources/echo-cwa.ts with a mocked fetch — no call to echodata.epa.gov.
// §0 greps index.ts so a revert of the call-site wiring cannot go green.
//
// Run: node test/echo-cwa-health.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = join(root, 'supabase/functions/get-address-report');

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 6)) {
  console.error(`FAIL — node ${process.versions.node} cannot strip TS types; need >= 22.6`);
  process.exit(1);
}

const M = await import(join(FN, 'sources/echo-cwa.ts'));
const indexSrc = readFileSync(join(FN, 'index.ts'), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const fac = (id = '110000000001') => [{ registry_id: id, label: 'Fixture Plant' }];

const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

function scriptedFetch(responses) {
  let i = 0;
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    if (i >= responses.length) throw new Error('unexpected extra fetch: ' + url);
    return responses[i++];
  };
  fn.calls = calls;
  return fn;
}

function happyEcho(rows, reported) {
  return scriptedFetch([
    jsonResp({ Results: { QueryID: 'Q1' } }),
    jsonResp({ Results: { QueryID: 'Q1', QueryRows: reported ?? rows.length, Facilities: rows } }),
  ]);
}

function happyCwa(rows) {
  return scriptedFetch([
    jsonResp({ Results: { QueryID: 'C1' } }),
    jsonResp({ Results: { Facilities: rows } }),
  ]);
}

// ── §0 call-site wiring ──────────────────────────────────────────────────────
ok(/echo, cwa/.test(indexSrc) && /enrichFacilityEnv/.test(indexSrc),
  'index.ts returns echo and cwa outcomes on the report body');
ok(/preserveStoredEnv/.test(indexSrc) && /loadStoredSites/.test(indexSrc),
  'a failed call reloads stored sites and restores env.epa before the write');
ok(/enrichRadiusMi\(facResult\.epa/.test(indexSrc),
  'ECHO/CWA use the radius FRS actually answered at, not the requested radius');
ok(!/if \(!r1\.ok\) return;\s*\n\s*const qid/.test(indexSrc),
  'the silent `if (!r1.ok) return` path is no longer inlined in index.ts');

// ── radius helper ────────────────────────────────────────────────────────────
ok(M.enrichRadiusMi({ radius_used: 2 }, 3) === 2,
  'enrichRadiusMi prefers FRS radius_used');
ok(M.enrichRadiusMi({ radius_used: null }, 3) === 3,
  'enrichRadiusMi falls back to the requested radius when FRS did not answer');

// ── echoEnrich outcomes ──────────────────────────────────────────────────────
{
  const sites = fac();
  const fetchImpl = happyEcho([{
    RegistryID: '110000000001',
    CWAComplianceStatus: 'Violation',
    FacSNCFlg: 'N',
    FacStreet: '1 Main',
    FacZip: '01610',
  }], 1);
  const out = await M.echoEnrich(sites, 42.26, -71.8, 3, fetchImpl);
  ok(/echo_rest_services\.get_facilities/.test(fetchImpl.calls[0]),
    'ECHO get_facilities URL', fetchImpl.calls[0]);
  ok(/echo_rest_services\.get_qid/.test(fetchImpl.calls[1]) && /responseset=500/.test(fetchImpl.calls[1]),
    'ECHO get_qid uses responseset=500', fetchImpl.calls[1]);
  ok(out.attempted && out.ok && out.matched === 1 && out.query_rows === 1,
    'success: attempted+ok+matched, not a silent void', JSON.stringify(out));
  ok(out.query_rows_reported === 1, 'QueryRows is recorded when the payload names it');
  ok(Array.isArray(sites[0].env.epa.in_violation) && sites[0].env.epa.in_violation[0] === 'CWA',
    'matched facility is stamped with interpretEcho');
  ok(sites[0].viol === 1, 'legacy viol equals open-violation count');
}

{
  const sites = fac();
  const out = await M.echoEnrich(sites, 42.26, -71.8, 3, async () => jsonResp({}, 503));
  ok(out.attempted && out.ok === false && out.reason === 'http_503' && out.matched === 0,
    'HTTP 503 is ok:false / http_503, not "no data"', JSON.stringify(out));
  ok(!sites[0].env, 'a failed call does not stamp env.epa');
}

{
  const sites = fac();
  const out = await M.echoEnrich(sites, 42.26, -71.8, 3, scriptedFetch([
    jsonResp({ Results: {} }),
  ]));
  ok(out.ok === false && out.reason === 'no_qid',
    'missing QueryID is a failed call, not an empty match', JSON.stringify(out));
}

{
  const sites = fac();
  const out = await M.echoEnrich(sites, 42.26, -71.8, 3, async () => {
    const e = new Error('aborted');
    e.name = 'TimeoutError';
    throw e;
  });
  ok(out.ok === false && out.reason === 'timeout',
    'AbortSignal timeout is ok:false / timeout', JSON.stringify(out));
}

{
  const sites = fac();
  const out = await M.echoEnrich(sites, 42.26, -71.8, 3, happyEcho([], 0));
  ok(out.ok === true && out.matched === 0 && out.query_rows === 0,
    'EPA answered with zero rows: ok:true matched=0 (authoritative absence)');
  ok(!sites[0].env, 'authoritative zero does not invent env.epa');
}

{
  const out = await M.echoEnrich([{}], 42.26, -71.8, 3, async () => { throw new Error('should not fetch'); });
  ok(out.attempted === false && out.ok === true && out.reason === 'no_registry_ids',
    'no registry ids: not attempted, not a failure');
}

// ── cwaPermitEnrich ──────────────────────────────────────────────────────────
{
  const sites = fac();
  const fetchImpl = happyCwa([{
    RegistryID: '110000000001',
    SourceID: 'MA0000001',
    Statute: 'CWA',
    CWPPermitStatusDesc: 'Effective',
    CWPPermitTypeDesc: 'NPDES Individual Permit',
  }]);
  const out = await M.cwaPermitEnrich(sites, 42.26, -71.8, 3, fetchImpl);
  ok(/cwa_rest_services\.get_facilities/.test(fetchImpl.calls[0]),
    'CWA get_facilities URL', fetchImpl.calls[0]);
  ok(/cwa_rest_services\.get_qid/.test(fetchImpl.calls[1]) && /qcolumns=1(%2C|,)2(%2C|,)9(%2C|,)11(%2C|,)51(%2C|,)54/.test(fetchImpl.calls[1]),
    'CWA get_qid pins the verified qcolumns', fetchImpl.calls[1]);
  ok(out.ok && out.matched === 1, 'CWA success matches on registry id');
  ok(sites[0].env.epa.permit_status === 'Effective' && sites[0].env.epa.compliance_tracking_on === true,
    'headline status + tracking_on derive from the most-active permit');
}

{
  const sites = fac();
  const out = await M.cwaPermitEnrich(sites, 42.26, -71.8, 3, async () => jsonResp({}, 502));
  ok(out.ok === false && out.reason === 'http_502',
    'CWA HTTP failure is recorded, not swallowed');
}

// ── preserveStoredEnv ────────────────────────────────────────────────────────
{
  const sites = fac();
  const stored = M.storedEpaByRegistryId([
    { registry_id: '110000000001', env: { epa: { in_violation: ['CAA'], current_as_of: '2026-08-01', permit_status: 'Effective', compliance_tracking_on: true } } },
  ]);
  const echo = { attempted: true, ok: false, reason: 'timeout', matched: 0, query_rows: 0, query_rows_reported: null, duration_ms: 25 };
  const cwa = { attempted: true, ok: false, reason: 'timeout', matched: 0, query_rows: 0, query_rows_reported: null, duration_ms: 25 };
  const r = M.preserveStoredEnv(sites, stored, echo, cwa);
  ok(r.restored_echo === 1 && r.restored_cwa === 1,
    'failed ECHO+CWA restore both halves from the store');
  ok(sites[0].env.epa.in_violation[0] === 'CAA' && sites[0].env.epa.permit_status === 'Effective',
    'restored fields are the stored ones, not invented zeros');
  ok(sites[0].viol === 1, 'legacy viol is rebuilt from the restored in_violation list');
}

{
  const sites = fac();
  const stored = M.storedEpaByRegistryId([
    { registry_id: '110000000001', env: { epa: { in_violation: ['CWA'], current_as_of: '2026-08-01' } } },
  ]);
  const echo = { attempted: true, ok: true, reason: null, matched: 0, query_rows: 0, query_rows_reported: 0, duration_ms: 4 };
  const cwa = { attempted: true, ok: true, reason: null, matched: 0, query_rows: 0, query_rows_reported: 0, duration_ms: 4 };
  const r = M.preserveStoredEnv(sites, stored, echo, cwa);
  ok(r.restored_echo === 0 && r.restored_cwa === 0 && !sites[0].env,
    'a successful empty answer does NOT resurrect stored env — that is real absence');
}

{
  const sites = [{
    registry_id: '110000000001',
    env: { link_type: 'geo_matched', epa: { in_violation: ['RCRA'], current_as_of: '2026-09-27' } },
  }];
  const stored = M.storedEpaByRegistryId([
    { registry_id: '110000000001', env: { epa: { in_violation: ['CWA'], permit_status: 'Expired', compliance_tracking_on: true, current_as_of: '2026-08-01' } } },
  ]);
  const echo = { attempted: true, ok: true, reason: null, matched: 1, query_rows: 1, query_rows_reported: 1, duration_ms: 8 };
  const cwa = { attempted: true, ok: false, reason: 'timeout', matched: 0, query_rows: 0, query_rows_reported: null, duration_ms: 25 };
  const r = M.preserveStoredEnv(sites, stored, echo, cwa);
  ok(r.restored_echo === 0 && r.restored_cwa === 1,
    'ECHO success + CWA failure restores only permit fields');
  ok(sites[0].env.epa.in_violation[0] === 'RCRA' && sites[0].env.epa.permit_status === 'Expired',
    'this-run ECHO facts win; stored permit_status fills the hole');
}

{
  const sites = fac('110000000099');
  const stored = M.storedEpaByRegistryId([
    { registry_id: '110000000001', env: { epa: { in_violation: ['CWA'] } } },
  ]);
  const echo = { attempted: true, ok: false, reason: 'http_503', matched: 0, query_rows: 0, query_rows_reported: null, duration_ms: 2 };
  const cwa = { attempted: true, ok: true, reason: null, matched: 0, query_rows: 0, query_rows_reported: 0, duration_ms: 3 };
  const r = M.preserveStoredEnv(sites, stored, echo, cwa);
  ok(r.restored_echo === 0 && !sites[0].env,
    'restore is keyed on registry id — a new facility does not inherit a neighbor');
}

console.log(fails === 0 ? '\nALL PASS — echo-cwa-health' : `\n${fails} FAILURE(S) — echo-cwa-health`);
process.exit(fails === 0 ? 0 : 1);
