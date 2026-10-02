// A TRIAL REPORT THROUGH THE REAL LAYERS (Development Activity build steps 5b, 5c and 5d).
// Creating the trial (5d, an admin) and joining it (5c) go through the real handler and data layer of development-activity-trial;
// making reports goes through
// the real request handler and the real data layer of get-development-activity-report, the real snapshot module and the real
// SQL of record (account spine, private context, snapshot, evaluation entitlement). The only translation is the network: a
// request the data layer would send to PostgREST is run as the same database function call through psql, and a database
// refusal comes back the way PostgREST returns it (HTTP 400, its message). The engine's inputs (geocode, spatial read, project
// rows) are fixtures, as in test/national_report_pg. Every assertion is about what the database holds afterwards.
//   Run through: bash test/trial_report_pg/run.sh   (it prepares the database and refuses anything not named disposable)
import { spawnSync } from 'node:child_process';

const H = await import('../../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../../supabase/functions/get-development-activity-report/data.ts');
const TH = await import('../../supabase/functions/development-activity-trial/handler.ts');
const TD = await import('../../supabase/functions/development-activity-trial/data.ts');

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
  evaluation_invite_redeem: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_invite_redeem(:'t', :'u'::uuid) t", { t: a.p_token, u: a.p_user_id }],
  // PostgREST passes a JSON null as SQL null; psql variables cannot carry one, so '' stands for null here and nowhere else
  evaluation_create: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_create(:'n', nullif(:'s', '')::integer, nullif(:'e', '')::timestamptz) t",
    { n: a.p_brokerage_name, s: a.p_seat_limit === null ? '' : String(a.p_seat_limit), e: a.p_expires_at === null ? '' : a.p_expires_at }],
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

// ---- the people: one who joins a fresh evaluation through the trial function, and others who do not ----------------------------
const MEMBER = 'a1111111-1111-4111-8111-111111111111', STRANGER = 'b2222222-2222-4222-8222-222222222222', LATE = 'c3333333-3333-4333-8333-333333333333';
one("insert into auth.users (id, email) values (:'a'::uuid, 'agent@example.test'), (:'b'::uuid, 'someone@example.test'), (:'c'::uuid, 'late@example.test')", { a: MEMBER, b: STRANGER, c: LATE });
async function trialAsk(userId, body, admin = false) {
  const real = TD.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc' }, fetchToSql);
  const h = TH.makeHandler({ ...real, authenticate: async () => ({ email: 'someone@example.test', id: userId }), isAdmin: async () => admin });
  const res = await h(new Request('https://x/functions/v1/development-activity-trial',
    { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const members = () => Number(one('select count(*) from public.brokerage_member'));
const tally = () => one("select (select count(*) from public.brokerage_account) || ' ' || (select count(*) from public.evaluation) || ' ' || (select count(*) from public.evaluation_invite)");
const ADMIN = 'd4444444-4444-4444-8444-444444444444';
one("insert into auth.users (id, email) values (:'d'::uuid, 'founder@example.test')", { d: ADMIN });

// ---- 0-. creating the trial, through the trial function (build step 5d) ---------------------------------------------------------------------
let t = await trialAsk(STRANGER, { action: 'create', brokerage_name: 'Round Trip Realty' });
ok(t.status === 403 && t.json.error === 'forbidden' && tally() === '0 0 0' && !seen.some((x) => /evaluation_create/.test(x)),
  '0-a a signed-in person who is not an admin cannot create a trial: nothing is written, and the database function is never called', t.json);
t = await trialAsk(ADMIN, { action: 'create', brokerage_name: '  Round Trip Realty ' }, true);
ok(t.status === 200 && t.json.brokerage_name === 'Round Trip Realty' && t.json.seat_limit === null && t.json.trial_ends_at === null
   && /^https:\/\/homesignal\.net\/development-activity-reports\.html#invite=hse1_[0-9a-f]{64}$/.test(t.json.invite_link),
  '0-b an admin creates a trial: the answer is the owner invite link', t.json);
const token = new URL(t.json.invite_link).hash.slice('#invite='.length);
const evalId = one("select e.evaluation_id from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Round Trip Realty'");
ok(tally() === '1 1 1' && one("select status || ' ' || coalesce(seat_limit::text, 'none') || ' ' || coalesce(expires_at::text, 'none') from public.evaluation where evaluation_id = :'e'::uuid", { e: evalId }) === 'active none none',
  '0-c the database holds one brokerage account (named as typed, trimmed), one active trial with no seat limit and no end date, and one invite');
ok(one("select count(*) from public.evaluation_invite where evaluation_id = :'e'::uuid and role = 'owner' and status = 'open' and token_hash = encode(sha256(convert_to(:'t', 'UTF8')), 'hex')", { e: evalId, t: token }) === '1',
  '0-d the link carries the token of that trial\'s one OPEN OWNER invite (only its hash is stored)');
ok(Math.abs(Date.parse(t.json.invite_expires_at) - Date.now() - 14 * 86_400_000) < 120_000, '0-e the invite lives the database\'s default 14 days (D-L4)', t.json.invite_expires_at);
ok(!new RegExp(evalId + '|' + one("select brokerage_id from public.evaluation where evaluation_id = :'e'::uuid", { e: evalId })).test(JSON.stringify(t.json)), '0-f the answer carries neither the trial\'s id nor the brokerage\'s');
t = await trialAsk(ADMIN, { action: 'create', brokerage_name: 'Bounded Realty', seat_limit: 2, trial_days: 30 }, true);
const bounded = one("select e.seat_limit || ' ' || extract(epoch from e.expires_at - e.created_at)::bigint from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Bounded Realty'").split(' ');
ok(t.status === 200 && bounded[0] === '2' && Math.abs(Number(bounded[1]) - 30 * 86_400) < 120, '0-g a seat limit and a length reach the database as typed: 2 seats, ending 30 days after creation', bounded);
t = await trialAsk(ADMIN, { action: 'create', brokerage_name: 'Bad Seats Realty', seat_limit: -1 }, true);
ok(t.status === 400 && t.json.detail === 'seat_limit' && tally() === '2 2 2', '0-h a refused field never reaches the database: nothing more is written', t.json);

// ---- 0. joining, through the trial function (build step 5c) -------------------------------------------------------------------------
t = await trialAsk(MEMBER, { action: 'status' });
ok(t.status === 200 && t.json.access === 'none' && t.json.trial === null, '0a before joining, the person has no trial', t.json);
t = await trialAsk(MEMBER, { action: 'redeem', token });
ok(t.status === 200 && t.json.role === 'owner' && t.json.replayed === false && t.json.access === 'trial' && t.json.trial.credits_remaining === 20 && t.json.trial.credits_used === 0,
  '0b the invite link joins the trial: owner, twenty free reports left', t.json);
ok(members() === 1 && one("select user_id || ' ' || role from public.brokerage_member") === MEMBER + ' owner', '0c the database holds one membership, for that person, as owner');
ok(!JSON.stringify(t.json).includes(evalId), '0d the answer carries no evaluation id');
t = await trialAsk(MEMBER, { action: 'redeem', token });
ok(t.status === 200 && t.json.replayed === true && members() === 1, '0e opening the same invite again is a replay: nothing changes', t.json);
t = await trialAsk(STRANGER, { action: 'redeem', token });
ok(t.status === 400 && t.json.error === 'invite_unusable' && members() === 1, '0f someone else cannot use an invite that is already used', t.json);
const before0 = seen.length;
t = await trialAsk(STRANGER, { action: 'redeem', token: 'hse1_' + 'g'.repeat(64) });
ok(t.status === 400 && t.json.error === 'invite_unusable' && !seen.slice(before0).some((x) => /evaluation_invite_redeem/.test(x)), '0g a malformed token never reaches the database');
// a second brokerage: its owner invite cannot be used by someone who already belongs to one; its agent seats can be full
t = await trialAsk(ADMIN, { action: 'create', brokerage_name: 'Other Realty', seat_limit: 0 }, true);
const token2 = new URL(t.json.invite_link).hash.slice('#invite='.length);
t = await trialAsk(MEMBER, { action: 'redeem', token: token2 });
ok(t.status === 409 && t.json.error === 'already_a_member' && members() === 1, '0h a person already in a brokerage cannot join another (one membership per person)', t.json);
const [ev3] = one("select evaluation_id || ' ' || owner_token from public.evaluation_create('Seatless Realty', 0)").split(' ');
const agentToken = one("select token from public.evaluation_invite_mint(:'e'::uuid, 'agent')", { e: ev3 });
t = await trialAsk(LATE, { action: 'redeem', token: agentToken });
ok(t.status === 409 && t.json.error === 'seat_limit_reached' && members() === 1, '0i an agent invite on a trial with no free seats is refused', t.json);

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
t = await trialAsk(MEMBER, { action: 'status' });
ok(t.status === 200 && t.json.access === 'complete' && t.json.trial.credits_remaining === 0 && t.json.trial.credits_used === 20,
  '6e the trial function now says the trial is complete: twenty used, none left', t.json);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
