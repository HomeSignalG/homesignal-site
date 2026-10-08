// THE CLIENT SHARE LINK, edge half (Development Activity build step 8) — offline.
//   supabase/functions/_shared/share-reads.ts         the link's one form, the secret's one mint, the database calls
//   supabase/functions/_shared/private-subject.ts      the one reader of the private layer, and its address-only window
//   supabase/functions/manage-shared-report            an agent makes, lists and revokes links (signed-in)
//   supabase/functions/view-shared-report              a client holding a link reads the report (NOT signed in)
//
//   1. the link: its one form, a fresh 256-bit token every time, the hash that is sent equals an independent SHA-256 of the token in the
//      link, and the token itself is sent nowhere;
//   2. manage: the gate (no token, the anon key, a user with no id) refuses BEFORE the body is read; a closed field set per action; the
//      answer to create is the link, once; each database refusal has its own answer; list and revoke;
//   3. view: no sign-in, one closed field, ONE answer (404) for every link that opens nothing, the exact shape of an answer, never the
//      label, a share id, an agent or a user, the address only while the private layer keeps it, a failed read is 502 and never "not found";
//   4. the real data layers: exactly the requests each makes, with the service key, and nothing else.
// test/report_share_delivery_pg proves the database half; test/report-share-delivery-structure.test.mjs pins the structure.
// Run: node test/share-link-functions.test.mjs
import { createHash } from 'node:crypto';

const R = await import('../supabase/functions/_shared/share-reads.ts');
const S = await import('../supabase/functions/_shared/private-subject.ts');
const G = await import('../supabase/functions/_shared/admin-gate.ts');
const Svc = await import('../supabase/functions/_shared/service-rest.ts');
const MH = await import('../supabase/functions/manage-shared-report/handler.ts');
const MD = await import('../supabase/functions/manage-shared-report/data.ts');
const VH = await import('../supabase/functions/view-shared-report/handler.ts');
const VD = await import('../supabase/functions/view-shared-report/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const UID = 'a1111111-1111-4111-8111-111111111111';
const REPORT = 'b2222222-2222-4222-8222-222222222222';
const SHARE = 'c3333333-3333-4333-8333-333333333333';
const CTX = 'd4444444-4444-4444-8444-444444444444';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const STORED = '{"product":"HomeSignal Development Activity","coverage":{"state":"covered"},"n":1}';
const KEY = 'service-key-xyz';

// ---- a scripted rpc: records every call and answers from a table -------------------------------------------------------------------------------
function rpcWith(table) {
  const calls = [];
  const rpc = async (fn, args) => { calls.push([fn, args]); const a = table[fn]; if (!a) throw new Svc.DataUnavailable('no script for ' + fn); return typeof a === 'function' ? a(args) : a; };
  return { rpc, calls };
}
const okRows = (rows) => ({ data: rows, error: null });
const refused = (message) => ({ data: null, error: { message } });

// ---- 1. the link and the secret --------------------------------------------------------------------------------------------------------------------
{
  const t = 'A'.repeat(43);
  ok(R.SHARE_PAGE === 'https://homesignal.net/shared-report.html' && R.shareLink(t) === 'https://homesignal.net/shared-report.html#share=' + t,
    '1a the link has ONE form: the page, and the token in the URL FRAGMENT (which no server receives)');
  let threw = 0;
  for (const bad of ['', 'short', t + 'A', t.slice(1) + '+', 't'.repeat(42) + ' ', null, 5]) { try { R.shareLink(bad); } catch (e) { if (e instanceof Svc.DataUnavailable) threw++; } }
  ok(threw === 7, '1b a link is built only from a well-formed token: seven malformed values are each refused', threw);

  const { rpc, calls } = rpcWith({ evaluation_report_share_create: okRows([{ share_id: SHARE, expires_at: '2027-04-03T12:00:00+00:00' }]) });
  const reads = R.makeShareReads(rpc);
  const a = await reads.createShare(UID, REPORT);
  const b = await reads.createShare(UID, REPORT);
  const tokenOf = (link) => link.split('#share=')[1];
  ok(TOKEN_RE.test(tokenOf(a.link)) && TOKEN_RE.test(tokenOf(b.link)) && tokenOf(a.link) !== tokenOf(b.link),
    '1c every link carries a fresh 43-character token: two calls, two different tokens');
  ok(calls.length === 2 && calls[0][1].p_token_sha256 === sha(tokenOf(a.link)) && calls[1][1].p_token_sha256 === sha(tokenOf(b.link)),
    '1d the hash the database receives equals an INDEPENDENT SHA-256 of the token in the link, for both');
  const everything = JSON.stringify(calls);
  ok(!everything.includes(tokenOf(a.link)) && !everything.includes(tokenOf(b.link)), '1e the token itself is sent to the database nowhere: only its hash');
  ok(JSON.stringify(Object.keys(calls[0][1]).sort()) === JSON.stringify(['p_report_id', 'p_token_sha256', 'p_user_id']) && calls[0][1].p_user_id === UID && calls[0][1].p_report_id === REPORT,
    '1f create asks for exactly the user, the report and the hash: no expiry (the database owns the six months)');
  ok(JSON.stringify(Object.keys(a).sort()) === JSON.stringify(['expires_at', 'link', 'share_id']), '1g the answer is the share id, its expiry and the link, nothing else', Object.keys(a));
}
{
  // each database refusal becomes a named error; anything else is "unavailable", never "refused"
  const go = async (script, f) => { try { await f(R.makeShareReads(rpcWith(script).rpc)); return 'returned'; } catch (e) { return e.constructor.name; } };
  ok(await go({ evaluation_report_share_create: refused('NOT_FOUND') }, (r) => r.createShare(UID, REPORT)) === 'ShareNotFound', '1h NOT_FOUND is ShareNotFound');
  ok(await go({ evaluation_report_share_create: refused('SHARE_LIMIT_REACHED') }, (r) => r.createShare(UID, REPORT)) === 'ShareLimitReached', '1i SHARE_LIMIT_REACHED is ShareLimitReached');
  ok(await go({ evaluation_report_share_create: refused('duplicate key value violates unique constraint') }, (r) => r.createShare(UID, REPORT)) === 'DataUnavailable', '1j any other refusal is DataUnavailable, not a named answer');
  ok(await go({ evaluation_report_share_create: okRows([]) }, (r) => r.createShare(UID, REPORT)) === 'DataUnavailable', '1k a create that returns no row is a fault');
  ok(await go({}, (r) => r.createShare(UID, 'not-a-uuid')) === 'ShareNotFound', '1l a report id that is not a UUID never reaches the database');
  ok(await go({ evaluation_report_share_revoke: refused('NOT_FOUND') }, (r) => r.revokeShare(UID, SHARE)) === 'ShareNotFound', '1m a revoke of a link that is not the caller\'s is ShareNotFound');
  ok(await go({ evaluation_report_share_revoke: okRows('yes') }, (r) => r.revokeShare(UID, SHARE)) === 'DataUnavailable', '1n a revoke answer that is not a boolean is a fault');
}
{
  const row = { share_id: SHARE, created_at: '2026-10-03T12:00:00+00:00', expires_at: '2027-04-03T12:00:00+00:00', revoked_at: null, status: 'ACTIVE' };
  const reads = (rows) => R.makeShareReads(rpcWith({ evaluation_report_shares_of: okRows(rows) }).rpc);
  ok((await reads([row, { ...row, status: 'REVOKED', revoked_at: '2026-10-04T00:00:00+00:00' }]).listShares(UID, REPORT)).length === 2, '1o a list is read as the database gives it');
  const bads = [{ ...row, status: 'UNKNOWN' }, { ...row, status: 'active' }, { ...row, share_id: 'x' }, { ...row, created_at: 'soon' }, { ...row, token_sha256: sha('x'), status: 'NOPE' }];
  let faults = 0;
  for (const b of bads) { try { await reads([b]).listShares(UID, REPORT); } catch (e) { if (e instanceof Svc.DataUnavailable) faults++; } }
  ok(faults === 5, '1p a row with an unknown status, a bad id or a bad time is a fault, never shown', faults);
  const leaked = await reads([{ ...row, token_sha256: sha('x') }]).listShares(UID, REPORT);
  ok(!('token_sha256' in leaked[0]) && JSON.stringify(Object.keys(leaked[0]).sort()) === JSON.stringify(['created_at', 'expires_at', 'revoked_at', 'share_id', 'status']),
    '1q a listed link carries five fields and never a hash, even when the database row held one', Object.keys(leaked[0]));
  ok((await R.makeShareReads(rpcWith({}).rpc).listShares(UID, 'nope')).length === 0, '1r a report id that is not a UUID lists nothing, without a database call');
  let lf = 'none';
  try { await R.makeShareReads(rpcWith({ evaluation_report_shares_of: refused('boom') }).rpc).listShares(UID, REPORT); lf = 'returned'; } catch (e) { lf = e.constructor.name; }
  ok(lf === 'DataUnavailable', '1r2 a list the database refuses is a fault, never an empty list (an empty list would say "no links" about a report that has some)', lf);
}
{
  const row = { report_id: REPORT, generated_at: '2026-10-03T12:00:00+00:00', body: STORED, private_context_id: CTX, brokerage_name: 'Acme Realty' };
  const t = 'Q'.repeat(43);
  const { rpc, calls } = rpcWith({ report_share_open: okRows([row]) });
  const reads = R.makeShareReads(rpc);
  const got = await reads.openShared(t);
  ok(got && got.body === STORED && got.brokerage_name === 'Acme Realty' && calls.length === 1 && calls[0][0] === 'report_share_open'
     && calls[0][1].p_token_sha256 === sha(t) && !JSON.stringify(calls).includes(t), '1s opening a link sends the SHA-256 of the token and never the token');
  let touched = 0;
  const spy = R.makeShareReads(async () => { touched++; return okRows([row]); });
  for (const bad of [undefined, null, 5, {}, [], '', 'short', t + 'Q', 'Q'.repeat(42) + '=', 'Q'.repeat(42) + '/']) if ((await spy.openShared(bad)) !== null) touched += 100;
  ok(touched === 0, '1t a value that could never have been a token opens nothing and reaches the database never (ten values)');
  ok((await R.makeShareReads(rpcWith({ report_share_open: okRows([]) }).rpc).openShared(t)) === null, '1u a link the database opens nothing for is null');
  let f = 0;
  for (const bad of [[row, row], [{ ...row, body: 5 }], [{ ...row, report_id: 'x' }], [{ ...row, generated_at: 'x' }], [{ ...row, private_context_id: 'x' }], [{ ...row, brokerage_name: 5 }]]) {
    try { await R.makeShareReads(rpcWith({ report_share_open: okRows(bad) }).rpc).openShared(t); } catch (e) { if (e instanceof Svc.DataUnavailable) f++; }
  }
  ok(f === 6, '1v two rows, or a row of the wrong shape, is a fault and never a report', f);
  let g = 'none';
  try { await R.makeShareReads(rpcWith({ report_share_open: refused('boom') }).rpc).openShared(t); } catch (e) { g = e.constructor.name; }
  ok(g === 'DataUnavailable', '1w a database error on open is DataUnavailable, never "not found"', g);
  let nonArray = 0;
  for (const bad of [null, {}, 'x', 5, true]) {
    try { await R.makeShareReads(rpcWith({ report_share_open: okRows(bad) }).rpc).openShared(t); } catch (e) { if (e instanceof Svc.DataUnavailable) nonArray++; }
  }
  ok(nonArray === 5, '1w2 an answer that is not a list at all is a fault named DataUnavailable (never a crash, and never "not found")', nonArray);
}

// ---- 2. manage-shared-report ----------------------------------------------------------------------------------------------------------------------------
const mcalls = [];
function mdeps(over = {}) {
  const rec = (name, f) => async (...a) => { mcalls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'agent@example.test', id: UID }))),
    isAdmin: rec('isAdmin', over.isAdmin ?? (async () => false)),
    createShare: rec('createShare', over.createShare ?? (async () => ({ share_id: SHARE, expires_at: '2027-04-03T12:00:00+00:00', link: R.shareLink('Z'.repeat(43)) }))),
    listShares: rec('listShares', over.listShares ?? (async () => [])),
    revokeShare: rec('revokeShare', over.revokeShare ?? (async () => true)),
  };
}
async function mask(d, body, { method = 'POST', auth = 'Bearer t', raw, origin } = {}) {
  mcalls.length = 0;
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  if (origin) headers.origin = origin;
  const init = { method, headers };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await MH.makeHandler(d)(new Request('https://x/functions/v1/manage-shared-report', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cache: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin') };
}
const mnamed = (name) => mcalls.filter((c) => c[0] === name);
{
  let r = await mask(mdeps(), null, { method: 'GET', auth: null });
  ok(r.status === 200 && r.json.link_lifetime === '6 months' && r.cache === 'no-store', '2a the capability states the 6-month lifetime and is never cached');
  r = await mask(mdeps(), { action: 'list', report_id: REPORT }, { auth: null });
  ok(r.status === 401 && mcalls.length === 0, '2b no token: refused 401, and nothing was asked of anyone');
  r = await mask(mdeps({ authenticate: async () => null }), { action: 'list', report_id: REPORT });
  ok(r.status === 401 && mnamed('listShares').length === 0, '2c the public anon key (no user): refused 401');
  r = await mask(mdeps({ authenticate: async () => ({ email: 'a@example.test' }) }), { action: 'list', report_id: REPORT });
  ok(r.status === 403 && mnamed('listShares').length === 0, '2d a user with no id: refused 403');
  r = await mask(mdeps({ authenticate: async () => { throw new Svc.DataUnavailable('x'); } }), { action: 'list', report_id: REPORT });
  ok(r.status === 502 && mnamed('listShares').length === 0, '2e an unreachable user lookup is 502, never "allowed"');
  r = await mask(mdeps(), null, { raw: 'x'.repeat(5000) });
  ok(r.status === 413 && mcalls.every((c) => c[0] !== 'createShare'), '2f a body over the cap is 413 (after the gate)');
  r = await mask(mdeps(), null, { method: 'DELETE' });
  ok(r.status === 405, '2g any method but GET, POST and OPTIONS is 405');
}
{
  const cases = [
    [{ action: 'create', report_id: REPORT, expires_at: '2099-01-01' }, 'a create cannot carry an expiry: the database owns the 6 months'],
    [{ action: 'create', report_id: REPORT, token: 'x'.repeat(43) }, 'a create cannot carry a token: the token is minted on the server'],
    [{ action: 'list', report_id: REPORT, share_id: SHARE }, 'a list carries a report id and nothing else'],
    [{ action: 'revoke', share_id: SHARE, report_id: REPORT }, 'a revoke carries a share id and nothing else'],
    [{ action: 'create' }, 'a create needs a report id'],
    [{ action: 'revoke', report_id: SHARE }, 'a revoke needs a SHARE id'],
    [{ action: 'create', report_id: 'nope' }, 'a report id must be a UUID'],
    [{ action: 'revoke', share_id: 5 }, 'a share id must be a string'],
    [{ action: 'frobnicate', report_id: REPORT }, 'an unknown action'],
    [{ action: 'constructor', report_id: REPORT }, 'an inherited property name is not an action'],
    [{ report_id: REPORT }, 'no action'],
    [[], 'an array body'],
    [null, 'a null body'],
  ];
  let all = true, touched = 0;
  for (const [body, why] of cases) {
    const r = await mask(mdeps(), body);
    const good = r.status === 400 && r.json?.error === 'bad_request';
    touched += mcalls.filter((c) => ['createShare', 'listShares', 'revokeShare'].includes(c[0])).length;
    if (!good) { all = false; console.log('   not refused: ' + why + ' → ' + r.status); }
  }
  ok(all && touched === 0, '2h every malformed or extra-field request is 400, and the database is never asked (13 cases)');
}
{
  let r = await mask(mdeps(), { action: 'create', report_id: REPORT });
  ok(r.status === 200 && JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['expires_at', 'link', 'share_id', 'status'])
     && r.json.link === R.shareLink('Z'.repeat(43)) && r.cache === 'no-store', '2i create answers the link, once, with its id and expiry, and nothing else; never cached');
  ok(JSON.stringify(mnamed('createShare')) === JSON.stringify([['createShare', UID, REPORT]]), '2j and asks for the SIGNED-IN person\'s id, never one the body supplied');
  r = await mask(mdeps({ createShare: async () => { throw new R.ShareNotFound('x'); } }), { action: 'create', report_id: REPORT });
  ok(r.status === 404 && r.json.error === 'not_found', '2k a report that is not theirs, does not exist or has no standing is 404 not_found');
  r = await mask(mdeps({ createShare: async () => { throw new R.ShareLimitReached('x'); } }), { action: 'create', report_id: REPORT });
  ok(r.status === 409 && r.json.error === 'share_limit_reached', '2l a report with 25 links is 409 share_limit_reached');
  r = await mask(mdeps({ createShare: async () => { throw new Svc.DataUnavailable('x'); } }), { action: 'create', report_id: REPORT });
  ok(r.status === 502 && r.json.error === 'data_unavailable', '2m an unreachable database is 502');
  r = await mask(mdeps({ createShare: async () => { throw new Error('boom with 1 Main St'); } }), { action: 'create', report_id: REPORT });
  ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes('Main St'), '2n any other failure is 500 and its message is never shown');
  const rows = [{ share_id: SHARE, created_at: '2026-10-03T12:00:00+00:00', expires_at: '2027-04-03T12:00:00+00:00', revoked_at: null, status: 'ACTIVE' }];
  r = await mask(mdeps({ listShares: async () => rows }), { action: 'list', report_id: REPORT });
  ok(r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ status: 'OK', shares: rows }) && !/token|hash/i.test(r.text), '2o list answers the rows and no token or hash');
  ok(JSON.stringify(mnamed('listShares')) === JSON.stringify([['listShares', UID, REPORT]]), '2o2 and list asks for the SIGNED-IN person\'s id, as create and revoke do');
  r = await mask(mdeps({ revokeShare: async () => false }), { action: 'revoke', share_id: SHARE });
  ok(r.status === 200 && r.json.revoked === false && JSON.stringify(mnamed('revokeShare')) === JSON.stringify([['revokeShare', UID, SHARE]]), '2p revoke says whether THIS call revoked it (false: it already was)');
  r = await mask(mdeps({ revokeShare: async () => { throw new R.ShareNotFound('x'); } }), { action: 'revoke', share_id: SHARE });
  ok(r.status === 404 && r.json.error === 'not_found', '2q revoking a link that is not theirs is 404');
  r = await mask(mdeps({ isAdmin: async () => true }), { action: 'create', report_id: REPORT });
  ok(r.status === 200 && mnamed('createShare').length === 1, '2r an admin is just a signed-in person here: the database decides, not the allow-list');
  r = await mask(mdeps(), { action: 'list', report_id: REPORT }, { origin: 'https://evil.example' });
  ok(r.acao === null, '2s a foreign origin gets no CORS grant');
  r = await mask(mdeps(), { action: 'list', report_id: REPORT }, { origin: 'https://homesignal.net' });
  ok(r.acao === 'https://homesignal.net', '2t the site\'s own origin does');
}

// ---- 3. view-shared-report ----------------------------------------------------------------------------------------------------------------------------------
const vcalls = [];
const vclaims = [];   // the rate limit's calls are kept apart from the data reads, so every assertion about what the function READS stays about reads
const CLIENT = 'c'.repeat(64);
function vdeps(over = {}) {
  const rec = (name, f) => async (...a) => { vcalls.push([name, ...a]); return f(...a); };
  const claimRec = (name, f) => async (...a) => { vclaims.push([name, ...a]); vcalls.push(['@' + name]); return f(...a); };
  return {
    linkKey: claimRec('linkKey', over.linkKey ?? (async (t) => (typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t) ? sha(t) : null))),
    clientKey: claimRec('clientKey', over.clientKey ?? (async () => CLIENT)),
    viewClaim: claimRec('viewClaim', over.viewClaim ?? (async () => ({ allowed: true }))),
    openShared: rec('openShared', over.openShared ?? (async () => ({ report_id: REPORT, generated_at: '2026-10-03T12:00:00+00:00', body: STORED, private_context_id: CTX, brokerage_name: 'Acme Realty' }))),
    addressOf: rec('addressOf', over.addressOf ?? (async () => '1 Centre Street, New York, NY 10007')),
  };
}
async function vask(d, body, { method = 'POST', headers = {}, raw } = {}) {
  vcalls.length = 0; vclaims.length = 0;
  const init = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await VH.makeHandler(d)(new Request('https://x/functions/v1/view-shared-report', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cache: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin') };
}
{
  const TOK = 'T'.repeat(43);
  let r = await vask(vdeps(), { token: TOK });
  ok(r.status === 200 && vcalls.every((c) => c[0] !== 'authenticate'), '3a a client opens a link with NO sign-in: no Authorization header is needed, and none is read');
  ok(JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['address', 'brokerage', 'coverage_state', 'generated_at', 'report', 'report_id', 'status']),
    '3b the answer has exactly seven fields', Object.keys(r.json));
  ok(r.json.status === 'OK' && r.json.coverage_state === 'covered' && r.json.report.n === 1 && r.json.brokerage === 'Acme Realty' && r.json.address === '1 Centre Street, New York, NY 10007'
     && r.json.report_id === REPORT && r.json.generated_at === '2026-10-03T12:00:00+00:00', '3c and they are the stored report as stored, the brokerage\'s name and the street address (founder: the client sees it)');
  ok(JSON.stringify(vcalls.filter((c) => !c[0].startsWith('@'))) === JSON.stringify([['openShared', TOK], ['addressOf', CTX]]), '3d the token goes to ONE call, and the address is read for the report\'s own context handle only');
  ok(r.cache === 'no-store', '3e a shared report is never cached');
  ok(!/label|share_id|agent|user|evaluation|token/i.test(r.text.replace(/"product":"HomeSignal Development Activity"/, '')), '3f nothing in the answer names a label, a share id, an agent, a user, an evaluation or a token');
}
{
  const same = [];
  const ask = async (token) => { const r = await vask(vdeps({ openShared: async () => null }), { token }); same.push(r.status + ':' + r.text); return r; };
  await ask('T'.repeat(43)); await ask('unknown'); await ask(''); await ask(null); await ask(12345); await ask(['x']); await ask({ a: 1 });
  ok(new Set(same).size === 1 && same[0] === '404:{"error":"not_found"}', '3g a link that opens nothing - unknown, revoked, expired, withdrawn, malformed or not even a string - is ONE answer: 404 not_found, byte for byte', same);
  const r = await vask(vdeps({ openShared: async () => null }), { token: 'T'.repeat(43) });
  ok(vcalls.filter((c) => !c[0].startsWith('@')).length === 1 && vcalls.filter((c) => !c[0].startsWith('@'))[0][0] === 'openShared', '3h and nothing else is read for it: no address is looked up for a link that opens nothing');
  ok(r.cache === 'no-store', '3i the refusal is not cached either');
}
{
  const cases = [[{ token: 'T'.repeat(43), x: 1 }, 'an extra field'], [{}, 'no token'], [[], 'an array'], [null, 'null'], ['"x"', 'a string body']];
  let all = true;
  for (const [b, why] of cases) {
    const r = typeof b === 'string' ? await vask(vdeps(), null, { raw: b }) : await vask(vdeps(), b);
    // an object with no token is a link that opens nothing (404); the rest are malformed (400). Either way nothing was read for an extra field.
    const good = (r.status === 400 && r.json?.error === 'bad_request') || (Object.keys(b || {}).length === 0 && !Array.isArray(b) && b !== null && r.status === 404);
    if (!good) { all = false; console.log('   unexpected: ' + why + ' → ' + r.status); }
  }
  ok(all, '3j a request with an extra field, an array, null or a bare string is 400, and an object with no token is the generic 404');
  const extra = await vask(vdeps(), { token: 'T'.repeat(43), x: 1 });
  ok(extra.status === 400 && vcalls.length === 0, '3k an extra field is refused before the database is asked (and before the rate limit: it is not a link request)');
  let r = await vask(vdeps(), null, { raw: 'x'.repeat(5000) });
  ok(r.status === 413 && vcalls.length === 0, '3l a body over the cap is 413');
  r = await vask(vdeps(), null, { raw: '{not json' });
  ok(r.status === 400 && vcalls.length === 0, '3m a body that is not JSON is 400');
  r = await vask(vdeps(), null, { method: 'PUT' });
  ok(r.status === 405, '3n any method but GET, POST and OPTIONS is 405');
  r = await vask(vdeps(), null, { method: 'GET' });
  ok(r.status === 200 && r.json.writes.length === 0 && vcalls.length === 0 && /rate limited/.test(r.json.rate_limit), '3o GET answers the capability (it names the rate limit) and reads nothing');
}
{
  let r = await vask(vdeps({ addressOf: async () => null }), { token: 'T'.repeat(43) });
  ok(r.status === 200 && r.json.address === null && r.json.report.n === 1, '3p once the private layer has purged the address, the report still opens, with no address');
  r = await vask(vdeps({ openShared: async () => { throw new Svc.DataUnavailable('x'); } }), { token: 'T'.repeat(43) });
  ok(r.status === 502 && r.json.error === 'data_unavailable', '3q a database that cannot be reached is 502 - never "not found" (a client must not be told a good link is dead)');
  r = await vask(vdeps({ addressOf: async () => { throw new Svc.DataUnavailable('x'); } }), { token: 'T'.repeat(43) });
  ok(r.status === 502 && !r.text.includes('Acme') && !r.text.includes('"report"'), '3r an address read that fails is 502 and returns NO report (a half answer is not given)');
  r = await vask(vdeps({ openShared: async () => ({ report_id: REPORT, generated_at: '2026-10-03T12:00:00+00:00', body: 'not json', private_context_id: null, brokerage_name: null }) }), { token: 'T'.repeat(43) });
  ok(r.status === 502, '3s a stored body that is not JSON is a fault, 502');
  r = await vask(vdeps({ openShared: async () => { throw new Error('boom at 1 Main St'); } }), { token: 'T'.repeat(43) });
  ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes('Main St'), '3t any other failure is 500 and its message is never shown');
  r = await vask(vdeps({ openShared: async () => ({ report_id: REPORT, generated_at: '2026-10-03T12:00:00+00:00', body: STORED, private_context_id: null, brokerage_name: '  Acme‮ Realty \n' }) }), { token: 'T'.repeat(43) });
  ok(r.json.brokerage === 'Acme Realty', '3u the brokerage name is cleaned for printing (control characters become spaces) on the way out');
  r = await vask(vdeps(), { token: 'T'.repeat(43) }, { headers: { origin: 'https://evil.example' } });
  ok(r.acao === null, '3v a foreign origin gets no CORS grant: another site\'s page cannot read a report with a link it was handed');
  r = await vask(vdeps(), { token: 'T'.repeat(43) }, { headers: { origin: 'https://www.homesignal.net' } });
  ok(r.acao === 'https://www.homesignal.net', '3w the site\'s own origins do');
}

// ---- 3x. THE RATE LIMIT (docs/da-owner-safeguards.sql part B) ---------------------------------------------------------------------------------------------------
{
  const TOK = 'T'.repeat(43);
  let r = await vask(vdeps(), { token: TOK });
  ok(r.status === 200 && vclaims.length === 3 && vclaims[2][0] === 'viewClaim' && vclaims[2][1] === CLIENT && vclaims[2][2] === sha(TOK),
    '3x1 a request takes ONE claim: the caller\'s hashed key and the SHA-256 of the link\'s token, nothing else');
  ok(vcalls[2][0] === '@viewClaim' && vcalls[3][0] === 'openShared', '3x2 the claim comes BEFORE the link is looked up');
  r = await vask(vdeps({ openShared: async () => null }), { token: 'unknown' });
  ok(r.status === 404 && vclaims[2][2] === null && vcalls.map((c) => c[0]).slice(0, 3).join() === '@linkKey,@clientKey,@viewClaim', '3x3 a malformed token still takes the caller\'s windows (link null) before anything else (the link reader itself sends nothing for it: 4f)');
  r = await vask(vdeps({ openShared: async () => null }), { token: 12345 });
  ok(r.status === 404 && vclaims[2][2] === null, '3x4 and so does a token that is not even a string');
  const full = { allowed: false, retryAfterSeconds: 37, limitedBy: 'client', windowSeconds: 60 };
  r = await vask(vdeps({ viewClaim: async () => full }), { token: TOK });
  ok(r.status === 429 && r.json.error === 'rate_limited' && r.json.retry_after_seconds === 37 && JSON.stringify(Object.keys(r.json).sort()) === '["error","retry_after_seconds"]' && r.cache === 'no-store',
    '3x5 a full window is 429 rate_limited with how long to wait - and nothing about who or which window');
  ok(vcalls.every((c) => ['@linkKey', '@clientKey', '@viewClaim'].includes(c[0])), '3x6 a refused request opens nothing: no link lookup, no address read');
  r = await vask(vdeps({ viewClaim: async () => { throw new Svc.DataUnavailable('x'); } }), { token: TOK });
  ok(r.status === 502 && r.json.error === 'data_unavailable' && !vcalls.some((c) => c[0] === 'openShared'), '3x7 a limiter that cannot be read is 502 and the link is NOT opened (fails closed)');
  r = await vask(vdeps({ clientKey: async () => { throw new Svc.DataUnavailable('x'); } }), { token: TOK });
  ok(r.status === 502 && !vcalls.some((c) => c[0] === 'openShared'), '3x8 a caller key that cannot be made is 502 and the link is NOT opened');
  let refused = 0;
  for (const bad of [{ allowed: true }]) { const q = await vask(vdeps({ viewClaim: async () => bad }), { token: TOK }); if (q.status === 200) refused++; }
  ok(refused === 1, '3x9 an allowed claim goes on to open the link');
  r = await vask(vdeps({ viewClaim: async () => full }), { token: 'unknown' });
  ok(r.status === 429, '3x10 a flood of unknown links is limited too: the claim does not depend on the link being real');
}
{
  const R = await import('../supabase/functions/_shared/rate-reads.ts');
  const h = (o) => new Headers(o);
  ok(R.networkAddressOf(h({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1, 10.0.0.1', 'x-real-ip': '192.0.2.5' })) === '203.0.113.9', '3y1 the edge\'s own header wins over the ones a caller could write');
  ok(R.networkAddressOf(h({ 'x-real-ip': '192.0.2.5', 'x-forwarded-for': '198.51.100.1' })) === '192.0.2.5' && R.networkAddressOf(h({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' })) === '198.51.100.1', '3y2 then x-real-ip, then the first x-forwarded-for entry');
  ok(R.networkAddressOf(h({})) === 'unknown', '3y3 no address at all is one shared "unknown", limited together');
  const k1 = await R.shareClientKey(h({ 'cf-connecting-ip': '203.0.113.9' }), 'secret-one');
  const k2 = await R.shareClientKey(h({ 'cf-connecting-ip': '203.0.113.9' }), 'secret-one');
  const k3 = await R.shareClientKey(h({ 'cf-connecting-ip': '203.0.113.10' }), 'secret-one');
  const k4 = await R.shareClientKey(h({ 'cf-connecting-ip': '203.0.113.9' }), 'secret-two');
  ok(/^[0-9a-f]{64}$/.test(k1) && k1 === k2 && k1 !== k3 && k1 !== k4, '3y4 the caller key is 64 hex digits, the same for the same address, different for another address and for another secret');
  ok(!k1.includes('203') || !k1.includes('113'), '3y5 and it does not contain the address');
  let e = 'none'; try { await R.shareClientKey(h({}), ''); } catch (x) { e = x.constructor.name; }
  ok(e === 'DataUnavailable', '3y6 with no secret there is no key (an unsalted hash of an address is an address)', e);
  const mk = (rows, err) => R.makeShareViewRateReads(async () => err ? { data: null, error: { message: 'x' } } : { data: rows, error: null });
  ok(JSON.stringify(await mk([{ allowed: true, retry_after_seconds: 0, limited_by: null, limited_window_secs: null }]).claim(k1, sha('x'))) === '{"allowed":true}', '3y7 an allowed claim reads allowed');
  const refusedV = await mk([{ allowed: false, retry_after_seconds: 12, limited_by: 'link', limited_window_secs: 3600 }]).claim(k1, null);
  ok(refusedV.allowed === false && refusedV.retryAfterSeconds === 12 && refusedV.limitedBy === 'link' && refusedV.windowSeconds === 3600, '3y8 a refusal reads who, which window and how long');
  let f = 0;
  for (const bad of [[], [{ allowed: true }, { allowed: true }], [{ allowed: 'yes' }], [{ allowed: true, retry_after_seconds: 5, limited_by: null, limited_window_secs: null }], [{ allowed: false, retry_after_seconds: 0, limited_by: 'client', limited_window_secs: 60 }],
    [{ allowed: false, retry_after_seconds: 5, limited_by: 'user', limited_window_secs: 60 }], [{ allowed: false, retry_after_seconds: 5, limited_by: 'client', limited_window_secs: 61 }], null, 'x']) {
    try { await mk(bad).claim(k1, null); } catch (x) { if (x instanceof Svc.DataUnavailable) f++; }
  }
  ok(f === 9, '3y9 an answer of the wrong shape is a fault, never "allowed" (nine shapes)', f);
  let g = 0;
  try { await mk(null, true).claim(k1, null); } catch (x) { if (x instanceof Svc.DataUnavailable) g++; }
  try { await mk([]).claim('nothex', null); } catch (x) { if (x instanceof Svc.DataUnavailable) g++; }
  try { await mk([]).claim(k1, 'nothex'); } catch (x) { if (x instanceof Svc.DataUnavailable) g++; }
  ok(g === 3, '3y10 a database error, or a subject that is not a hash, is a fault before anything is sent', g);
}

// ---- 4. the real data layers ----------------------------------------------------------------------------------------------------------------------------------
function stub(routes) {
  const reqs = [];
  const f = async (url, init) => {
    reqs.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    for (const [re, fn] of routes) if (re.test(String(url))) return fn(init);
    return new Response('{}', { status: 404 });
  };
  return { f, reqs };
}
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const CFG = { url: 'https://proj.supabase.co', serviceKey: KEY };
{
  const T = 'V'.repeat(43);
  const { f, reqs } = stub([
    [/rpc\/share_view_claim$/, () => json([{ allowed: true, retry_after_seconds: 0, limited_by: null, limited_window_secs: null }])],
    [/rpc\/report_share_open$/, () => json([{ report_id: REPORT, generated_at: '2026-10-03T12:00:00+00:00', body: STORED, private_context_id: CTX, brokerage_name: 'Acme Realty' }])],
    [/rpc\/report_private_context_read$/, () => json([{ state: 'active', address: '1 Centre Street, New York, NY 10007', label: 'Smith listing — difficult buyer', normalized_address: '1 CENTRE ST', latitude: 40.7, longitude: -74, property_keys: ['k'] }])],
  ]);
  const res = await VH.makeHandler(VD.makeDeps(CFG, f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: T }) }));
  const text = await res.text();
  ok(res.status === 200 && reqs.length === 3 && reqs[0].url === 'https://proj.supabase.co/rest/v1/rpc/share_view_claim' && reqs[1].url === 'https://proj.supabase.co/rest/v1/rpc/report_share_open' && reqs[2].url === 'https://proj.supabase.co/rest/v1/rpc/report_private_context_read',
    '4a the real view function makes exactly three requests: the rate-limit claim, the link\'s open, then the report\'s own private context', reqs.map((r) => r.url));
  ok(/^[0-9a-f]{64}$/.test(reqs[0].body.p_client) && reqs[0].body.p_link === sha(T) && Object.keys(reqs[0].body).length === 2 && !JSON.stringify(reqs[0].body).includes(T),
    '4a2 the claim carries a hashed caller key and the SHA-256 of the token and nothing else (no address, no token)');
  ok(reqs[1].body.p_token_sha256 === sha(T) && Object.keys(reqs[1].body).length === 1 && reqs[2].body.p_context === CTX && Object.keys(reqs[2].body).length === 1,
    '4b the open carries the hash of the token and nothing else; the context read carries the context handle and nothing else');
  ok(reqs.every((r) => r.method === 'POST' && r.headers.apikey === KEY && r.headers.Authorization === 'Bearer ' + KEY) && !JSON.stringify(reqs).includes(T),
    '4c both are POSTs with the service key, and the token itself appears in no request');
  const j = JSON.parse(text);
  ok(j.address === '1 Centre Street, New York, NY 10007' && !text.includes('Smith') && !text.includes('difficult') && !text.includes('CENTRE ST') && !text.includes('40.7') && !text.includes('"k"'),
    '4d the address comes back; the label the agent typed, the normalized address, the coordinates and the keys do NOT, though the private layer returned all of them');
}
{
  const OKCLAIM = [/rpc\/share_view_claim$/, () => json([{ allowed: true, retry_after_seconds: 0, limited_by: null, limited_window_secs: null }])];
  const { f, reqs } = stub([OKCLAIM, [/rpc\/report_share_open$/, () => json([])]]);
  const res = await VH.makeHandler(VD.makeDeps(CFG, f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'V'.repeat(43) }) }));
  ok(res.status === 404 && reqs.length === 2 && reqs[1].url.endsWith('report_share_open'), '4e a link that opens nothing costs the claim and the open, and the private layer is not touched');
  const none = stub([OKCLAIM]);
  const res2 = await VH.makeHandler(VD.makeDeps(CFG, none.f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'short' }) }));
  ok(res2.status === 404 && none.reqs.length === 1 && none.reqs[0].url.endsWith('share_view_claim') && none.reqs[0].body.p_link === null, '4f a malformed token makes ONE request, the claim (no link), and never reaches the link lookup');
  const limited = stub([[/rpc\/share_view_claim$/, () => json([{ allowed: false, retry_after_seconds: 40, limited_by: 'client', limited_window_secs: 60 }])]]);
  const res2b = await VH.makeHandler(VD.makeDeps(CFG, limited.f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'V'.repeat(43) }) }));
  ok(res2b.status === 429 && limited.reqs.length === 1, '4f2 a full window is 429 after the claim alone: the link is never looked up');
  const dead = stub([[/rpc\/share_view_claim$/, () => json({ message: 'boom' }, 500)]]);
  const res2c = await VH.makeHandler(VD.makeDeps(CFG, dead.f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'V'.repeat(43) }) }));
  ok(res2c.status === 502 && dead.reqs.length === 1, '4f3 a claim that cannot be made is 502 and nothing else is asked');
  const down = stub([OKCLAIM, [/rpc\/report_share_open$/, () => json({ message: 'boom' }, 500)]]);
  const res3 = await VH.makeHandler(VD.makeDeps(CFG, down.f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'V'.repeat(43) }) }));
  ok(res3.status === 502, '4g a 5xx from the database is 502');
  const refusing = stub([OKCLAIM, [/rpc\/report_share_open$/, () => json({ message: 'denied' }, 400)]]);
  const res4 = await VH.makeHandler(VD.makeDeps(CFG, refusing.f))(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'V'.repeat(43) }) }));
  ok(res4.status === 502, '4h a 4xx on the open is 502, never "not found": only the database answering with no row is "not found"');
}
{
  const T = 'W'.repeat(43);
  const { f, reqs } = stub([
    [/auth\/v1\/user$/, () => json({ id: UID, email: 'agent@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' })],
    [/dashboard_admins/, () => json([])],
    [/rpc\/evaluation_report_share_create$/, () => json([{ share_id: SHARE, expires_at: '2027-04-03T12:00:00+00:00' }])],
    [/rpc\/evaluation_report_shares_of$/, () => json([])],
    [/rpc\/evaluation_report_share_revoke$/, () => json(true)],
  ]);
  const h = MH.makeHandler(MD.makeDeps(CFG, f));
  const post = (b) => h(new Request('https://x/', { method: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: JSON.stringify(b) }));
  const made = await (await post({ action: 'create', report_id: REPORT })).json();
  const create = reqs.find((r) => /evaluation_report_share_create$/.test(r.url));
  ok(create && create.body.p_user_id === UID && create.body.p_report_id === REPORT && /^[0-9a-f]{64}$/.test(create.body.p_token_sha256)
     && sha(made.link.split('#share=')[1]) === create.body.p_token_sha256 && !JSON.stringify(reqs).includes(made.link.split('#share=')[1]),
    '4i the real manage function: the signed-in person\'s id comes from the verified token, the hash is the SHA-256 of the token in the link it returns, and the token is sent nowhere');
  await post({ action: 'list', report_id: REPORT }); await post({ action: 'revoke', share_id: SHARE });
  const fns = reqs.map((r) => r.url.split('/').pop()).filter((x) => /^evaluation_report_share/.test(x)).sort().join(',');
  ok(fns === 'evaluation_report_share_create,evaluation_report_share_revoke,evaluation_report_shares_of', '4j create, list and revoke are exactly three database functions', fns);
  ok(reqs.length >= 5 && reqs.every((r) => /\/auth\/v1\/user$|\/rest\/v1\/dashboard_admins\?|\/rest\/v1\/rpc\/evaluation_report_share(_create|s_of|_revoke)$/.test(r.url)),
    '4k and nothing else: the user lookup, the allow-list, and those three functions - no table is read, the private layer and the snapshot are not touched', reqs.map((r) => r.url));
}
{
  // the private-subject reader's two windows
  const row = { state: 'active', address: '1 Main St', label: '  Smith   buyers ', normalized_address: '1 MAIN ST', latitude: 1, longitude: 2, property_keys: ['k'] };
  const mk = (rows, err) => S.makePrivateSubjectReads(async () => err ? { data: null, error: { message: 'x' } } : { data: rows, error: null });
  const s = await mk([row]).subjectOf(CTX, 80);
  ok(JSON.stringify(s) === JSON.stringify({ address: '1 Main St', label: 'Smith buyers' }), '4l subjectOf returns the address and the cleaned label, and nothing else of the layer');
  const a = await mk([row]).addressOf(CTX);
  ok(a === '1 Main St' && typeof a === 'string', '4m addressOf returns the address as a bare string: there is no label in what it hands back');
  ok((await mk([{ ...row, state: 'purged', address: null }]).addressOf(CTX)) === null && (await mk([]).addressOf(CTX)) === null && (await mk([row]).addressOf(null)) === null,
    '4n a purged, missing or absent context has no address');
  let f = 0;
  for (const m of [mk(null, true), mk({}), mk([row, row])]) { try { await m.addressOf(CTX); if (m === undefined) f++; } catch (e) { if (e instanceof Svc.DataUnavailable) f++; } }
  // [row,row] is read as "no single context": no address, not a fault - the first two are faults
  ok(f >= 2, '4o a failed or oddly shaped read is DataUnavailable, never "no address"', f);
  ok((await mk([{ ...row, address: '' }]).addressOf(CTX)) === null, '4p an empty address is no address');
}

console.log('\n' + (n - bad) + ' of ' + n + ' passed');
if (bad) process.exit(1);
