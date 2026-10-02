// A TRIAL REPORT THROUGH THE REAL LAYERS (Development Activity build step 5b).
// The real request handler and the real data layer of get-development-activity-report, the real snapshot module and the real
// SQL of record (account spine, private context, snapshot, evaluation entitlement). The only translation is the network: a
// request the data layer would send to PostgREST is run as the same database function call through psql, and a database
// refusal comes back the way PostgREST returns it (HTTP 400, its message). The engine's inputs (geocode, spatial read, project
// rows) are fixtures, as in test/national_report_pg. Every assertion is about what the database holds afterwards.
//   Run through: bash test/trial_report_pg/run.sh   (it prepares the database and refuses anything not named disposable)
import { spawnSync } from 'node:child_process';

const H = await import('../../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../../supabase/functions/get-development-activity-report/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

function psql(query, vars = {}) {
  const args = ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', k + '=' + v);
  const r = spawnSync('psql', [...args, '-f', '-'], { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const one = (q, v) => { const r = psql(q, v); if (!r.ok) throw new Error('psql: ' + r.err); return r.out; };

// ---- the database's own functions, called the way PostgREST would call them -------------------------------------------------
const RPC = {
  evaluation_usage: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_usage(:'u'::uuid) t", { u: a.p_user_id }],
  evaluation_report_issue: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_report_issue(:'u'::uuid, :'k'::uuid, :'b', :'h', :'v', :'i'::jsonb, nullif(:'p', '')::jsonb) t",
    { u: a.p_user_id, k: a.p_idempotency_key, b: a.p_body, h: a.p_content_hash, v: a.p_report_version, i: JSON.stringify(a.p_engine_inputs), p: a.p_private === null ? '' : JSON.stringify(a.p_private) }],
  report_private_context_read: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.report_private_context_read(:'c'::uuid) t", { c: a.p_context }],
};
const seen = [];
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
async function fetchToSql(url, init = {}) {
  const u = new URL(url);
  seen.push(u.pathname + u.search);
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
  if (rpc) {
    if (!RPC[rpc[1]]) throw new Error('unexpected rpc ' + rpc[1]);
    const [q, v] = RPC[rpc[1]](JSON.parse(init.body));
    const r = psql(q, v);
    if (!r.ok) {
      // PostgREST: a raised exception is a 400 whose message is the exception's message (the SQLSTATE in `code`)
      const m = /ERROR:\s+(.*)/.exec(r.err);
      return json({ code: 'P0001', message: m ? m[1].trim() : r.err }, 400);
    }
    return json(JSON.parse(r.out));
  }
  if (u.pathname === '/rest/v1/report_snapshot') {
    const id = u.searchParams.get('report_id').replace(/^eq\./, '');
    if (u.searchParams.get('select') !== 'body') throw new Error('unexpected select ' + u.search);
    return json(JSON.parse(one("select coalesce(json_agg(json_build_object('body', body)), '[]') from public.report_snapshot where report_id = :'r'::uuid", { r: id })));
  }
  throw new Error('unexpected request ' + u.pathname);
}

// ---- the people: a member of a fresh evaluation, and someone who is not ---------------------------------------------------------
const MEMBER = 'a1111111-1111-4111-8111-111111111111', STRANGER = 'b2222222-2222-4222-8222-222222222222';
one("insert into auth.users (id, email) values (:'a'::uuid, 'agent@example.test'), (:'b'::uuid, 'someone@example.test')", { a: MEMBER, b: STRANGER });
const [evalId, token] = one("select evaluation_id || ' ' || owner_token from public.evaluation_create('Round Trip Realty')").split(' ');
one("select role from public.evaluation_invite_redeem(:'t', :'u'::uuid)", { t: token, u: MEMBER });

// ---- the engine's inputs, as in test/national_report_pg ------------------------------------------------------------------------
const FAM = 'wsdot-project-delivery-plan-proposed';
const CLEARED = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-10-02', audit_ref: 'round-trip fixture', attribution: 'Data: WSDOT' }] };
const NONE = { version: 1, cleared: [] };
const proj = { source_key: 'k1', registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised',
  developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WSDOTProjectDeliveryPlanCurrent/FeatureServer/0' };
const HOME = '742 Evergreen Terrace, Springfield, OR 97477', NEIGHBOUR = '744 Evergreen Terrace, Springfield, OR 97477';
function handlerFor(rights, userId) {
  const real = D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc', rights, now: () => new Date('2026-10-02T12:00:00Z') }, fetchToSql);
  return H.makeHandler({
    ...real,
    authenticate: async () => ({ email: 'agent@example.test', id: userId }),
    isAdmin: async () => false,
    geocode: async (a) => ({ matchedAddress: a.toUpperCase(), lat: 44.04612, lng: -122.98123, zip: '97477' }),
    zipSupported: async () => true,
    radius: async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.21, geometry_type: 'Point', has_more: false }],
    hydrate: async () => [proj], ledger: async () => [], events: async () => [], health: async () => [],
  });
}
async function ask(rights, userId, body) {
  const res = await handlerFor(rights, userId)(new Request('https://x/functions/v1/get-development-activity-report',
    { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const count = (t) => Number(one('select count(*) from public.' + t));
const key = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');

// ---- 1. a report that shows development: stored and charged, once, in the database -----------------------------------------------
let r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(1) });
ok(r.status === 200 && r.json.charged === true && r.json.stored === true && r.json.replayed === false && r.json.trial.credits_used === 1 && r.json.trial.credits_remaining === 19,
  '1a a trial report that shows development is charged: one used, nineteen left', [r.status, r.json.trial, r.json.error]);
const firstId = r.json.report_id;
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1 && one("select report_id from public.evaluation_credit") === firstId,
  '1b the database holds ONE stored report and ONE credit, and the credit points at that report');
const ctx = JSON.parse(one("select row_to_json(c) from public.report_private_context c join public.report_snapshot s on s.private_context_id = c.context_id where s.report_id = :'r'::uuid", { r: firstId }));
ok(ctx.address === HOME && ctx.state === 'active', '1c the typed address is in the deletable private context');
ok(!one("select body from public.report_snapshot where report_id = :'r'::uuid", { r: firstId }).includes('Evergreen'), '1d and NOT in the permanent report body');
ok(JSON.parse(one("select body from public.report_snapshot where report_id = :'r'::uuid", { r: firstId })).activity.outcome === 'DEVELOPMENT_SHOWN',
  '1e the stored report carries its outcome, so a reopened report says the same words');

// ---- 2. the page retries the same request: the first report, not charged again -------------------------------------------------
r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(1) });
ok(r.status === 200 && r.json.replayed === true && r.json.charged === false && r.json.report_id === firstId && r.json.trial.credits_used === 1,
  '2a a retry with the same key returns the first report and charges nothing', [r.status, r.json.replayed, r.json.trial]);
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1, '2b nothing new is stored or charged');

// ---- 3. the same key reused for a different property: refused, nothing shown, nothing charged -------------------------------------
r = await ask(CLEARED, MEMBER, { address: NEIGHBOUR, idempotency_key: key(1) });
ok(r.status === 409 && r.json.error === 'idempotency_key_reused' && r.json.report === undefined, '3a a reused key for another property is refused (409) and shows no report', r.json);
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1, '3b and nothing is stored or charged');

// ---- 4. "No data ingested": free, and stored nowhere ------------------------------------------------------------------------------
r = await ask(NONE, MEMBER, { address: NEIGHBOUR, idempotency_key: key(2) });
ok(r.status === 200 && r.json.report.activity.outcome === 'NO_DATA_INGESTED' && r.json.charged === false && r.json.stored === false && r.json.trial.credits_used === 1,
  '4a with nothing cleared the report is "No data ingested": not charged, not stored, still one used', [r.json.charged, r.json.trial]);
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1, '4b the database is unchanged');
ok(seen.some((s) => /rpc\/evaluation_report_issue$/.test(s)) && seen.some((s) => /rpc\/report_private_context_read$/.test(s)) && seen.some((s) => /report_snapshot\?select=body/.test(s)),
  '4c (control) the real data layer did reach the issue function, the private-context check and the stored-report read');

// ---- 5. someone who is not a member ---------------------------------------------------------------------------------------------------
r = await ask(CLEARED, STRANGER, { address: HOME, idempotency_key: key(3) });
ok(r.status === 403 && r.json.error === 'forbidden', '5a a signed-in person with no trial is refused', r.json);
ok(count('evaluation_credit') === 1, '5b and nothing is charged');

// ---- 6. the twentieth report ends the trial; the twenty-first is refused before any work ----------------------------------------------
for (let i = 10; i < 29; i++) await ask(CLEARED, MEMBER, { address: (100 + i) + ' Evergreen Terrace, Springfield, OR 97477', idempotency_key: key(i) });
ok(count('evaluation_credit') === 20 && count('report_snapshot') === 20 && one("select status from public.evaluation where evaluation_id = :'e'::uuid", { e: evalId }) === 'complete',
  '6a after twenty charged reports the trial is complete: twenty credits, twenty stored reports', [count('evaluation_credit'), count('report_snapshot')]);
const before = seen.length;
r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(40) });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && r.json.trial.credits_remaining === 0, '6b the next request is told the trial is complete (403), with its counts', r.json);
ok(seen.slice(before).every((s) => /evaluation_usage/.test(s)) && count('evaluation_credit') === 20, '6c and nothing past the trial read ran: no report made, nothing charged');
const ord = one("select string_agg(ordinal::text, ',' order by ordinal) from public.evaluation_credit");
ok(ord === Array.from({ length: 20 }, (_, i) => i + 1).join(','), '6d the ledger is the ordinals 1 to 20, no gap', ord);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
