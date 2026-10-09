// A TRIAL REPORT THROUGH THE REAL LAYERS (Development Activity build steps 5b, 5c, 5d, 5e, 6 and 7).
// Creating the trial (5d, an admin), joining it (5c) and an owner inviting agents (5e) go through the real handler and data layer of
// development-activity-trial;
// making reports goes through
// the real request handler and the real data layer of get-development-activity-report, the real snapshot module and the real
// SQL of record (account spine, private context, snapshot, evaluation entitlement). The only translation is the network: a
// request the data layer would send to PostgREST is run as the same database function call through psql, and a database
// refusal comes back the way PostgREST returns it (HTTP 400, its message). The engine's inputs (geocode, spatial read, project
// rows) are fixtures, as in test/national_report_pg. Every assertion is about what the database holds afterwards.
//   Run through: bash test/trial_report_pg/run.sh   (it prepares the database and refuses anything not named disposable)
import { spawnSync } from 'node:child_process';
import { LAUNCH_TEST_LOCATION as LOC, OTHER_PROPERTY, addressNo, geocodeStandIn } from '../lib/launch-test-location.mjs';

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
  // billing (build step 11): the member's plan is read through billing_usage, and a member's report is stored and charged by
  // brokerage_report_issue, the ONE entry that decides which allotment a report uses. The free evaluation's own issue function is NOT listed:
  // the handler calling it directly would be a second way to charge a report, and an unlisted call stops this run.
  billing_usage: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.billing_usage(:'u'::uuid) t", { u: a.p_user_id }],
  // the report rate limit (docs/report-rate-limit.sql): the wrapper on the database's own clock. The clocked variant is NOT listed: the handler must not be able to reach it.
  report_rate_claim: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.report_rate_claim(:'u'::uuid) t", { u: a.p_user }],
  brokerage_report_issue: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.brokerage_report_issue(:'u'::uuid, :'k'::uuid, :'b', :'h', :'v', :'i'::jsonb, nullif(:'p', '')::jsonb) t",
    { u: a.p_user_id, k: a.p_idempotency_key, b: a.p_body, h: a.p_content_hash, v: a.p_report_version, i: JSON.stringify(a.p_engine_inputs), p: a.p_private === null ? '' : JSON.stringify(a.p_private) }],
  report_private_context_read: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.report_private_context_read(:'c'::uuid) t", { c: a.p_context }],
  evaluation_invite_redeem: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_invite_redeem(:'t', :'u'::uuid) t", { t: a.p_token, u: a.p_user_id }],
  // PostgREST passes a JSON null as SQL null; psql variables cannot carry one, so '' stands for null here and nowhere else
  evaluation_create: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_create(:'n', nullif(:'s', '')::integer, nullif(:'e', '')::timestamptz) t",
    { n: a.p_brokerage_name, s: a.p_seat_limit === null ? '' : String(a.p_seat_limit), e: a.p_expires_at === null ? '' : a.p_expires_at }],
  // saved reports (build step 6): two read-only functions
  evaluation_reports_of: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_reports_of(:'u'::uuid) t", { u: a.p_user_id }],
  evaluation_report_open: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_report_open(:'u'::uuid, :'r'::uuid) t", { u: a.p_user_id, r: a.p_report_id }],
  // the header (build step 7): one read-only function
  report_header_of: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.report_header_of(:'u'::uuid) t", { u: a.p_user_id }],
  brokerage_membership_of: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.brokerage_membership_of(:'u'::uuid) t", { u: a.p_user_id }],
  brokerage_account_type_of: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.brokerage_account_type_of(:'u'::uuid) t", { u: a.p_user_id }],
  // the lifetime is left to the database's default, as PostgREST does when the argument is not sent
  evaluation_invite_mint: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.evaluation_invite_mint(p_evaluation_id => :'e'::uuid, p_role => :'r', p_actor => :'u'::uuid) t",
    { e: a.p_evaluation_id, r: a.p_role, u: a.p_actor }],
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
ok(t.status === 200 && t.json.role === 'owner' && t.json.replayed === false && t.json.access === 'trial' && t.json.trial.credits_remaining === 10 && t.json.trial.credits_used === 0,
  '0b the invite link joins the trial: owner, ten free reports left', t.json);
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

// ---- 0+. an owner invites agents, through the trial function (build step 5e) ------------------------------------------------------------
const tokenOf = (link) => new URL(link).hash.slice('#invite='.length);
const openAgentInvites = (e) => one("select count(*) from public.evaluation_invite where evaluation_id = :'e'::uuid and role = 'agent' and status = 'open'", { e });
t = await trialAsk(MEMBER, { action: 'status' });
ok(t.status === 200 && t.json.role === 'owner' && t.json.access === 'trial', '0j the owner\'s status says owner, from the membership resolver', t.json);
const invitesBefore = Number(one('select count(*) from public.evaluation_invite'));
t = await trialAsk(MEMBER, { action: 'invite' });
ok(t.status === 200 && /^https:\/\/homesignal\.net\/development-activity-reports\.html#invite=hse1_[0-9a-f]{64}$/.test(t.json.invite_link)
   && JSON.stringify(Object.keys(t.json).sort()) === '["invite_expires_at","invite_link","status"]' && !JSON.stringify(t.json).includes(evalId),
  '0k the owner makes an agent invite: the answer is the link and its expiry, and no id', t.json);
const agentLink = t.json.invite_link;
ok(Number(one('select count(*) from public.evaluation_invite')) === invitesBefore + 1
   && one("select count(*) from public.evaluation_invite where evaluation_id = :'e'::uuid and role = 'agent' and status = 'open' and token_hash = encode(sha256(convert_to(:'t', 'UTF8')), 'hex')", { e: evalId, t: tokenOf(agentLink) }) === '1'
   && one("select count(*) from public.evaluation_event where evaluation_id = :'e'::uuid and kind = 'invite_minted' and role = 'agent'", { e: evalId }) === '1',
  '0l the database holds exactly one new invite: an OPEN AGENT invite of the owner\'s own trial, the link\'s token hashed, and the minting is logged');
ok(Math.abs(Date.parse(t.json.invite_expires_at) - Date.now() - 14 * 86_400_000) < 120_000, '0m the agent invite lives the database\'s default 14 days (D-L4)', t.json.invite_expires_at);
t = await trialAsk(LATE, { action: 'redeem', token: tokenOf(agentLink) });
ok(t.status === 200 && t.json.role === 'agent' && t.json.access === 'trial' && members() === 2
   && one("select role from public.brokerage_member where user_id = :'u'::uuid", { u: LATE }) === 'agent',
  '0n the agent opens the link and joins the owner\'s trial as an AGENT, sharing its reports', t.json);
const invitesNow = Number(one('select count(*) from public.evaluation_invite'));
t = await trialAsk(LATE, { action: 'invite' });
ok(t.status === 403 && t.json.error === 'not_owner' && Number(one('select count(*) from public.evaluation_invite')) === invitesNow,
  '0o an agent cannot invite: the DATABASE refuses (NOT_ENTITLED) and nothing is written', t.json);
t = await trialAsk(STRANGER, { action: 'invite' });
ok(t.status === 403 && t.json.error === 'forbidden' && Number(one('select count(*) from public.evaluation_invite')) === invitesNow, '0p a person with no trial cannot invite', t.json);
t = await trialAsk(ADMIN, { action: 'invite' }, true);
ok(t.status === 403 && Number(one('select count(*) from public.evaluation_invite')) === invitesNow, '0q being an admin does not make an agent invite');
// a trial with one agent seat: the owner may make two links, and the second agent to open one is refused (seats are counted at joining)
const OWNER2 = 'e5555555-5555-4555-8555-555555555555', AGENT_A = 'f6666666-6666-4666-8666-666666666666', AGENT_B = 'a7777777-7777-4777-8777-777777777777';
one("insert into auth.users (id, email) values (:'o'::uuid, 'owner2@example.test'), (:'a'::uuid, 'a@example.test'), (:'b'::uuid, 'b@example.test')", { o: OWNER2, a: AGENT_A, b: AGENT_B });
const [evOne, ownerOne] = one("select evaluation_id || ' ' || owner_token from public.evaluation_create('One Seat Realty', 1)").split(' ');
t = await trialAsk(OWNER2, { action: 'redeem', token: ownerOne });
ok(t.status === 200 && t.json.role === 'owner', '0r the second owner joins their own trial', t.json);
const l1 = (await trialAsk(OWNER2, { action: 'invite' })).json.invite_link, l2 = (await trialAsk(OWNER2, { action: 'invite' })).json.invite_link;
ok(l1 && l2 && l1 !== l2 && openAgentInvites(evOne) === '2', '0s an owner may make one link per agent: two different links, two open agent invites', [l1, l2]);
t = await trialAsk(AGENT_A, { action: 'redeem', token: tokenOf(l1) });
const ta = t;
t = await trialAsk(AGENT_B, { action: 'redeem', token: tokenOf(l2) });
ok(ta.status === 200 && ta.json.role === 'agent' && t.status === 409 && t.json.error === 'seat_limit_reached'
   && one("select count(*) from public.brokerage_member m join public.evaluation e on e.brokerage_id = m.brokerage_id where e.evaluation_id = :'e'::uuid and m.role = 'agent'", { e: evOne }) === '1',
  '0t with one agent seat, the first agent joins and the second is refused: the limit holds however many links the owner made', [ta.json, t.json]);
// an ended trial: the handler refuses before asking; and if it did ask, the database would refuse on its own
one("select public.evaluation_revoke(:'e'::uuid)", { e: evOne });
const invitesRevoked = Number(one('select count(*) from public.evaluation_invite'));
t = await trialAsk(OWNER2, { action: 'invite' });
ok(t.status === 409 && t.json.error === 'trial_not_active' && Number(one('select count(*) from public.evaluation_invite')) === invitesRevoked, '0u the owner of a revoked trial cannot invite (409)', t.json);
let refused = null;
try { await TD.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc' }, fetchToSql).inviteAgent(OWNER2); } catch (e) { refused = e && e.constructor && e.constructor.name; }
ok(refused === 'NotEntitled' && Number(one('select count(*) from public.evaluation_invite')) === invitesRevoked,
  '0v asked directly, the data layer\'s mint is refused by the DATABASE for a revoked trial (NOT_ENTITLED): the handler\'s check is not the only guard', refused);

// ---- the engine's inputs, as in test/national_report_pg ------------------------------------------------------------------------
const FAM = 'wsdot-project-delivery-plan-proposed';
const CLEARED = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-10-02', audit_ref: 'round-trip fixture', attribution: 'Data: WSDOT' }] };
const NONE = { version: 1, cleared: [] };
const proj = { source_key: 'k1', registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised',
  developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WSDOTProjectDeliveryPlanCurrent/FeatureServer/0' };
const HOME = LOC.address, NEIGHBOUR = OTHER_PROPERTY; // the launch test location: Brigham City, UT 84302 (test/lib/launch-test-location.mjs)
function handlerFor(rights, userId) {
  const real = D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc', rights, now: () => new Date('2026-10-02T12:00:00Z') }, fetchToSql);
  return H.makeHandler({
    ...real,
    authenticate: async () => ({ email: 'agent@example.test', id: userId }),
    isAdmin: async () => false,
    geocode: async (a) => geocodeStandIn(a),
    zipSupported: async () => true,
    radius: async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.21, geometry_type: 'Point', has_more: false }],
    hydrate: async () => [proj], ledger: async () => [], events: async () => [], health: async () => [],
  });
}
// This suite makes dozens of reports in seconds to test the ENTITLEMENT (the 10, the ledger, saved reports); the report rate limit has its own suites
// (test/report_rate_limit_pg and section 15 of test/launch_gate_pg). So its counters are cleared before each request here, as the table's owner.
async function ask(rights, userId, body) {
  one('truncate public.report_rate_window');
  const res = await handlerFor(rights, userId)(new Request('https://x/functions/v1/get-development-activity-report',
    { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const count = (t) => Number(one('select count(*) from public.' + t));
const key = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');

// ---- 1. a report that shows development: stored and charged, once, in the database -----------------------------------------------
let r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(1) });
ok(r.status === 200 && r.json.charged === true && r.json.stored === true && r.json.replayed === false && r.json.trial.credits_used === 1 && r.json.trial.credits_remaining === 9,
  '1a a trial report that shows development is charged: one used, nine left', [r.status, r.json.trial, r.json.error]);
const firstId = r.json.report_id;
ok(JSON.stringify(r.json.header) === '{"brokerage":"Round Trip Realty","agent":null}',
  '1a2 the first report carries its viewer\'s header: the brokerage\'s name from the account, and no name because this person has given none', r.json.header);
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1 && one("select report_id from public.evaluation_credit") === firstId,
  '1b the database holds ONE stored report and ONE credit, and the credit points at that report');
const ctx = JSON.parse(one("select row_to_json(c) from public.report_private_context c join public.report_snapshot s on s.private_context_id = c.context_id where s.report_id = :'r'::uuid", { r: firstId }));
ok(ctx.address === HOME && ctx.state === 'active', '1c the typed address is in the deletable private context');
ok(!one("select body from public.report_snapshot where report_id = :'r'::uuid", { r: firstId }).includes('N Main St'), '1d and NOT in the permanent report body');
ok(JSON.parse(one("select body from public.report_snapshot where report_id = :'r'::uuid", { r: firstId })).activity.outcome === 'DEVELOPMENT_SHOWN',
  '1e the stored report carries its outcome, so a reopened report says the same words');

// ---- 2. the page retries the same request: the first report, not charged again -------------------------------------------------
r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(1) });
ok(r.status === 200 && r.json.replayed === true && r.json.charged === false && r.json.report_id === firstId && r.json.trial.credits_used === 1,
  '2a a retry with the same key returns the first report and charges nothing', [r.status, r.json.replayed, r.json.trial]);
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1, '2b nothing new is stored or charged');
// the person gives their name (it lives in their sign-in account: auth.users.raw_user_meta_data); the same retry now shows it, at no cost
one("update auth.users set raw_user_meta_data = jsonb_build_object('full_name', '  Pat   Agent ') where id = :'u'::uuid", { u: MEMBER });
r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(1) });
ok(r.json.replayed === true && r.json.charged === false && JSON.stringify(r.json.header) === '{"brokerage":"Round Trip Realty","agent":"Pat Agent"}' && count('evaluation_credit') === 1,
  '2c once the person has given a name, the same report shows it (cleaned to one line of plain text), read now, at no cost', r.json.header);

// ---- 3. the same key reused for a different property: refused, nothing shown, nothing charged -------------------------------------
r = await ask(CLEARED, MEMBER, { address: NEIGHBOUR, idempotency_key: key(1) });
ok(r.status === 409 && r.json.error === 'idempotency_key_reused' && r.json.report === undefined, '3a a reused key for another property is refused (409) and shows no report', r.json);
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1, '3b and nothing is stored or charged');

// ---- 4. "No data ingested": free, and stored nowhere ------------------------------------------------------------------------------
r = await ask(NONE, MEMBER, { address: NEIGHBOUR, idempotency_key: key(2) });
ok(r.status === 200 && r.json.report.activity.outcome === 'NO_DATA_INGESTED' && r.json.charged === false && r.json.stored === false && r.json.trial.credits_used === 1,
  '4a with nothing cleared the report is "No data ingested": not charged, not stored, still one used', [r.json.charged, r.json.trial]);
ok(JSON.stringify(r.json.header) === '{"brokerage":"Round Trip Realty","agent":"Pat Agent"}', '4a2 and it carries the same header');
ok(count('report_snapshot') === 1 && count('evaluation_credit') === 1, '4b the database is unchanged');
ok(seen.some((s) => /rpc\/brokerage_report_issue$/.test(s)) && seen.some((s) => /rpc\/billing_usage$/.test(s)) && seen.some((s) => /rpc\/report_private_context_read$/.test(s)) && seen.some((s) => /report_snapshot\?select=body/.test(s)),
  '4c (control) the real data layer did reach the plan read, the ONE issue function, the private-context check and the stored-report read');
ok(!seen.some((s) => /rpc\/evaluation_report_issue$/.test(s)) && count('brokerage_paid_credit') === 0,
  '4d no report was charged by calling the free evaluation function directly, and a trial pays for nothing: no paid credit exists');

// ---- 5. someone who is not a member ---------------------------------------------------------------------------------------------------
r = await ask(CLEARED, STRANGER, { address: HOME, idempotency_key: key(3) });
ok(r.status === 403 && r.json.error === 'forbidden', '5a a signed-in person with no trial is refused', r.json);
ok(count('evaluation_credit') === 1, '5b and nothing is charged');

// ---- 6. the tenth report ends the trial; the eleventh is refused before any work ----------------------------------------------
// the second charged report (i = 10) carries a client label, typed with stray spaces: it is kept in the private layer only (build step 7)
for (let i = 10; i < 19; i++) await ask(CLEARED, MEMBER, { address: addressNo(i), idempotency_key: key(i), ...(i === 10 ? { label: ' Smith   buyers ' } : {}) });
ok(count('evaluation_credit') === 10 && count('report_snapshot') === 10 && one("select status from public.evaluation where evaluation_id = :'e'::uuid", { e: evalId }) === 'complete',
  '6a after ten charged reports the trial is complete: ten credits, ten stored reports', [count('evaluation_credit'), count('report_snapshot')]);
const before = seen.length;
r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(40) });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && r.json.trial.credits_remaining === 0, '6b the next request is told the trial is complete (403), with its counts', r.json);
ok(seen.slice(before).every((s) => /rpc\/(evaluation_usage|billing_usage)$/.test(s)) && count('evaluation_credit') === 10, '6c and nothing past the trial and plan reads ran: no report made, nothing charged');
const ord = one("select string_agg(ordinal::text, ',' order by ordinal) from public.evaluation_credit");
ok(ord === Array.from({ length: 10 }, (_, i) => i + 1).join(','), '6d the ledger is the ordinals 1 to 10, no gap', ord);
t = await trialAsk(MEMBER, { action: 'status' });
ok(t.status === 200 && t.json.access === 'complete' && t.json.trial.credits_remaining === 0 && t.json.trial.credits_used === 10,
  '6e the trial function now says the trial is complete: ten used, none left', t.json);
const invitesDone = Number(one('select count(*) from public.evaluation_invite'));
t = await trialAsk(MEMBER, { action: 'invite' });
ok(t.status === 409 && t.json.error === 'trial_not_active' && Number(one('select count(*) from public.evaluation_invite')) === invitesDone,
  '6f the owner of a complete trial cannot invite: an agent joining it could make no report (build step 5e)', t.json);
t = await trialAsk(LATE, { action: 'status' });
ok(t.status === 200 && t.json.access === 'complete' && t.json.role === 'agent' && t.json.trial.credits_used === 10, '6g the agent sees the same shared trial: complete, ten used', t.json);

// ---- 7. saved reports (build step 6): list and reopen, through the real handler, data layer and SQL -------------------------------------------
// MEMBER's brokerage has used all ten free reports (section 6); LATE joined it as an AGENT (0n). Nothing below may write, charge or store.
const snapState = () => one("select (select count(*) from public.report_snapshot) || ' ' || (select count(*) from public.evaluation_credit) || ' ' || (select count(*) from public.evaluation_event) || ' ' || (select coalesce(sum(length(body)), 0) from public.report_snapshot) || ' ' || (select md5(string_agg(content_hash, ',' order by content_hash collate \"C\")) from public.report_snapshot)");
const before7 = snapState();
const savedAsk = (userId, body) => ask(CLEARED, userId, body);
const listed = await savedAsk(MEMBER, { action: 'list' });
ok(listed.status === 200 && listed.json.status === 'OK' && listed.json.reports.length === 10 && listed.json.reports.map((x) => x.number).join(',') === Array.from({ length: 10 }, (_, i) => 10 - i).join(','),
  '7a a member of a COMPLETE trial lists their brokerage\'s ten stored reports, newest first, numbered 10 down to 1', listed.json.reports && listed.json.reports.map((x) => x.number));
ok(listed.json.reports.every((x) => /^[0-9a-f-]{36}$/.test(x.report_id) && typeof x.generated_at === 'string' && typeof x.address === 'string' && x.address.length > 8)
   && new Set(listed.json.reports.map((x) => x.report_id)).size === 10 && listed.json.reports.find((x) => x.number === 1).report_id === firstId && listed.json.reports.find((x) => x.number === 1).address === HOME,
  '7b every row has its permanent id, time and address (while the private layer keeps it); report 1 is the first report made, for the first address', listed.json.reports[9]);
ok(JSON.stringify(Object.keys(listed.json.reports[0]).sort()) === '["address","generated_at","number","report_id"]' && !/context|evaluation|brokerage|credit/i.test(JSON.stringify(listed.json.reports)),
  '7c a row holds exactly id, number, time and address: no context handle, no evaluation, brokerage or credit id', Object.keys(listed.json.reports[0]));
const agentList = await savedAsk(LATE, { action: 'list' });
ok(agentList.status === 200 && JSON.stringify(agentList.json.reports) === JSON.stringify(listed.json.reports), '7d an AGENT of the same brokerage sees the same ten reports (every member sees all of the brokerage\'s reports, D-6-2)');

const storedBody = one("select body from public.report_snapshot where report_id = :'r'::uuid", { r: firstId });
const opened = await savedAsk(MEMBER, { action: 'open', report_id: firstId });
ok(opened.status === 200 && opened.json.status === 'OK' && opened.json.reopened === true && opened.json.stored === true && opened.json.charged === false
   && opened.json.report_id === firstId && opened.json.number === 1 && opened.json.address === HOME && opened.json.render === undefined && opened.json.credit === undefined,
  '7e opening report 1 returns it as reopened, stored and NOT charged, with its number and address, and no live render block', opened.json && Object.keys(opened.json));
ok(JSON.stringify(opened.json.report) === JSON.stringify(JSON.parse(storedBody)) && opened.json.report.activity.outcome === 'DEVELOPMENT_SHOWN',
  '7f the report shown is the STORED report, field for field (it is not recomputed from today\'s data)');
ok(snapState() === before7, '7g listing and opening wrote nothing: the same snapshots, credits, events, bytes and content hashes as before', [before7, snapState()]);
const agentOpen = await savedAsk(LATE, { action: 'open', report_id: firstId });
ok(agentOpen.status === 200 && JSON.stringify(agentOpen.json.report) === JSON.stringify(opened.json.report), '7h an agent opens a report the owner made: the same report');

// the header and the client label (build step 7)
const HDR_ALL = ['Pat Agent', 'Pat   Agent'];
const second = listed.json.reports.find((x) => x.number === 2);
const secondOpen = await savedAsk(MEMBER, { action: 'open', report_id: second.report_id });
ok(secondOpen.status === 200 && secondOpen.json.client_label === 'Smith buyers' && JSON.stringify(secondOpen.json.header) === '{"brokerage":"Round Trip Realty","agent":"Pat Agent"}',
  '7h2 a reopened report shows its client label (cleaned) and the viewer\'s own header: the brokerage from the account and the name the person gave', [secondOpen.json.client_label, secondOpen.json.header]);
const secondCtx = one("select private_context_id from public.report_snapshot where report_id = :'r'::uuid", { r: second.report_id });
ok(one("select label from public.report_private_context where context_id = :'c'::uuid", { c: secondCtx }) === 'Smith   buyers',
  '7h3 the client label was kept as typed (ends trimmed), in the deletable private layer');
const secondBody = one("select body from public.report_snapshot where report_id = :'r'::uuid", { r: second.report_id });
ok(!/Smith|Pat\b|Round Trip Realty/.test(secondBody) && JSON.stringify(secondOpen.json.report) === JSON.stringify(JSON.parse(secondBody)),
  '7h4 the PERMANENT report holds neither the label, an agent\'s name nor the brokerage\'s name, and a reopened report is that stored body unchanged');
const publicTables = one("select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'").split(',');
const holders = (needle) => publicTables.filter((tb) => Number(one('select count(*) from public."' + tb + '" x where x::text like :\'n\'', { n: '%' + needle + '%' })) > 0);
ok(publicTables.length > 8 && holders('Round Trip Realty').includes('brokerage_account') && holders('20 N Main St').includes('report_private_context'),
  '7h5 (control) the scan finds a value where it is kept: the brokerage\'s name on its account and the address in the private layer', publicTables.length);
ok(HDR_ALL.every((v) => holders(v).length === 0), '7h6 an agent\'s name is written in NO table of this database\'s public schema: it lives in their sign-in account alone', HDR_ALL.map(holders));
ok(JSON.stringify(holders('Smith')) === '["report_private_context"]' && holders('Smith buyers').length === 0,
  '7h7 the client label is written in ONE table, the deletable private layer, as typed (the cleaned one-line form is made only when it is shown)', holders('Smith'));
const lateOpen = await savedAsk(LATE, { action: 'open', report_id: second.report_id });
ok(lateOpen.status === 200 && lateOpen.json.client_label === 'Smith buyers' && JSON.stringify(lateOpen.json.header) === '{"brokerage":"Round Trip Realty","agent":null}',
  '7h8 an agent of the same brokerage sees the same label (it is the brokerage\'s) under THEIR OWN header: same brokerage, and no name because they gave none', lateOpen.json.header);
// a name or the brokerage renamed changes what is shown next time, never what was stored
const bodyHash = one("select md5(string_agg(body, '|' order by report_id)) from public.report_snapshot");
one("update auth.users set raw_user_meta_data = jsonb_build_object('full_name', 'Pat Q. Agent') where id = :'u'::uuid", { u: MEMBER });
one("update public.brokerage_account set name = 'Renamed Realty' where name = 'Round Trip Realty'");
const renamed = await savedAsk(MEMBER, { action: 'open', report_id: second.report_id });
ok(JSON.stringify(renamed.json.header) === '{"brokerage":"Renamed Realty","agent":"Pat Q. Agent"}' && JSON.stringify(renamed.json.report) === JSON.stringify(secondOpen.json.report)
   && one("select md5(string_agg(body, '|' order by report_id)) from public.report_snapshot") === bodyHash,
  '7h9 a new name and a renamed account show on the next open, and every stored report is byte for byte what it was (the header is read, never copied)', renamed.json.header);
one("update public.brokerage_account set name = 'Round Trip Realty' where name = 'Renamed Realty'");
one("update auth.users set raw_user_meta_data = jsonb_build_object('full_name', 'Pat Agent') where id = :'u'::uuid", { u: MEMBER });

// another brokerage: its own reports, and no way into this one
const NEWBIE = 'a8888888-8888-4888-8888-888888888888', BCODE = 'b9999999-9999-4999-8999-999999999999';
one("insert into auth.users (id, email) values (:'n'::uuid, 'newbie@example.test')", { n: NEWBIE });
const newbieToken = one("select owner_token from public.evaluation_create('Other Brokerage Realty')");
t = await trialAsk(NEWBIE, { action: 'redeem', token: newbieToken });
ok(t.status === 200 && t.json.role === 'owner', '7i a second brokerage\'s owner joins their own, fresh trial', t.json);
const otherList = await savedAsk(NEWBIE, { action: 'list' });
ok(otherList.status === 200 && otherList.json.reports.length === 0, '7j the other brokerage lists NO reports (none of the first brokerage\'s)', otherList.json);
const foreign = await savedAsk(NEWBIE, { action: 'open', report_id: firstId });
const unknownId = await savedAsk(NEWBIE, { action: 'open', report_id: BCODE });
ok(foreign.status === 404 && unknownId.status === 404 && JSON.stringify(foreign.json) === JSON.stringify(unknownId.json) && foreign.json.error === 'not_found' && !JSON.stringify(foreign.json).includes(firstId),
  '7k another brokerage\'s report id and an unknown id give the SAME answer (404 not_found): the caller cannot tell which exists', [foreign.json, unknownId.json]);
t = await trialAsk(NEWBIE, { action: 'status' });
ok(t.json.trial.credits_used === 0 && count('evaluation_credit') === 10, '7l and the other brokerage\'s trial is untouched: nothing was charged to either');

// no standing: nothing
const none = await savedAsk(STRANGER, { action: 'list' });
const noneOpen = await savedAsk(STRANGER, { action: 'open', report_id: firstId });
ok(none.status === 403 && noneOpen.status === 403 && none.json.error === 'forbidden', '7m a signed-in person with no trial can neither list nor open (403)', [none.json, noneOpen.json]);
const real7 = D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc', rights: CLEARED, now: () => new Date('2026-10-02T12:00:00Z') }, fetchToSql);
const adminH = H.makeHandler({ ...real7, authenticate: async () => ({ email: 'founder@example.test', id: ADMIN }), isAdmin: async () => true });
const adminRes = await adminH(new Request('https://x/f', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }));
ok(adminRes.status === 403, '7n an admin has no brokerage\'s reports to list: 403 (an admin report is never stored)', adminRes.status);

// the private layer: a privacy-request purge removes the address from the list, and leaves the report byte for byte
const ctxId = one("select private_context_id from public.report_snapshot where report_id = :'r'::uuid", { r: firstId });
const hashBefore = one("select content_hash from public.report_snapshot where report_id = :'r'::uuid", { r: firstId });
one("select public.report_private_context_purge(:'c'::uuid, 'verified_privacy_request')", { c: ctxId });
const afterPurge = await savedAsk(MEMBER, { action: 'list' });
const row1 = afterPurge.json.reports.find((x) => x.number === 1);
ok(row1.address === null && afterPurge.json.reports.filter((x) => x.address !== null).length === 9, '7o after a privacy-request purge that report\'s address is gone from the list (null) and the other nine keep theirs', row1);
const reopened = await savedAsk(MEMBER, { action: 'open', report_id: firstId });
ok(reopened.status === 200 && reopened.json.address === null && JSON.stringify(reopened.json.report) === JSON.stringify(opened.json.report)
   && one("select content_hash from public.report_snapshot where report_id = :'r'::uuid", { r: firstId }) === hashBefore,
  '7p the purged report still opens, identical to before, with no address; its stored hash is unchanged (history survives the privacy purge)');

// the label goes with the address when the private layer purges (build step 7)
one("select public.report_private_context_purge(:'c'::uuid, 'verified_privacy_request')", { c: secondCtx });
const purgedLabel = await savedAsk(MEMBER, { action: 'open', report_id: second.report_id });
ok(purgedLabel.status === 200 && purgedLabel.json.client_label === null && purgedLabel.json.address === null && purgedLabel.json.header && purgedLabel.json.header.brokerage === 'Round Trip Realty'
   && JSON.stringify(purgedLabel.json.report) === JSON.stringify(secondOpen.json.report) && holders('Smith').length === 0,
  '7p2 after a privacy purge the client label is gone from every table and from the reopened report, which is otherwise identical and still has its header', purgedLabel.json.client_label);

// bad requests
const badId = await savedAsk(MEMBER, { action: 'open', report_id: 'not-a-uuid' });
const extra = await savedAsk(MEMBER, { action: 'list', address: HOME });
const badAction = await savedAsk(MEMBER, { action: 'delete', report_id: firstId });
ok(badId.status === 400 && badId.json.detail === 'report_id' && extra.status === 400 && badAction.status === 400, '7q a malformed id, an extra field and an unknown action are refused (400)', [badId.json, extra.json, badAction.json]);

// the report function still cannot MAKE a report for a complete trial, and still refuses before any work
const beforeMake = seen.length;
r = await ask(CLEARED, MEMBER, { address: HOME, idempotency_key: key(60) });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && !seen.slice(beforeMake).some((x) => /brokerage_report_issue|evaluation_report_issue|report_snapshot/.test(x)) && count('evaluation_credit') === 10,
  '7r a complete trial still cannot make a report (403 evaluation_complete), and nothing was issued', r.json);

// a revoked evaluation: the gate refuses, and the database itself returns nothing
one("select public.evaluation_revoke(:'e'::uuid)", { e: evalId });
const revokedList = await savedAsk(MEMBER, { action: 'list' });
ok(revokedList.status === 403, '7s once the evaluation is revoked the report function refuses the member (403)', revokedList.json);
ok(one("select count(*) from public.evaluation_reports_of(:'u'::uuid)", { u: MEMBER }) === '0'
   && one("select count(*) from public.evaluation_report_open(:'u'::uuid, :'r'::uuid)", { u: MEMBER, r: firstId }) === '0',
  '7t and the database functions themselves return NOTHING for a revoked evaluation: the handler\'s refusal is not the only guard');
ok(count('report_snapshot') === 10 && count('evaluation_credit') === 10, '7u revoking leaves the ten stored reports and their ledger rows in place (nothing is deleted)');

// an ACTIVE evaluation whose end date has passed: the same rule as a revoked one (D-6-3). The other brokerage makes one report, then its end date passes.
r = await ask(CLEARED, NEWBIE, { address: HOME, idempotency_key: key(70) });
const otherReport = r.status === 200 ? one("select c.report_id from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Other Brokerage Realty'") : '';
ok(r.status === 200 && otherReport !== ''
   && one("select count(*) from public.evaluation_reports_of(:'u'::uuid)", { u: NEWBIE }) === '1'
   && one("select count(*) from public.evaluation_report_open(:'u'::uuid, :'r'::uuid)", { u: NEWBIE, r: otherReport }) === '1',
  '7v while its trial is active and unexpired the other brokerage lists and opens its one report', r.json);

ok(JSON.stringify(r.json.header) === '{"brokerage":"Other Brokerage Realty","agent":null}', '7v2 the other brokerage\'s report carries ITS OWN brokerage name, never the first one\'s', r.json.header);
one("update public.evaluation e set expires_at = e.created_at + interval '1 second' from public.brokerage_account a where a.id = e.brokerage_id and a.name = 'Other Brokerage Realty' and e.status = 'active'");
ok(one("select count(*) from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Other Brokerage Realty' and e.status = 'active' and e.expires_at < now()") === '1'
   && one("select count(*) from public.evaluation_reports_of(:'u'::uuid)", { u: NEWBIE }) === '0'
   && one("select count(*) from public.evaluation_report_open(:'u'::uuid, :'r'::uuid)", { u: NEWBIE, r: otherReport }) === '0'
   && count('report_snapshot') === 11,
  '7w once an ACTIVE trial\'s end date has passed the database functions return nothing, and the stored report is still there');

// ---- 8. who has a header (build step 7): the database function itself, called directly ----------------------------------------------------
const hdrRows = (u) => one("select count(*) from public.report_header_of(:'u'::uuid)", { u });
ok(hdrRows(STRANGER) === '0' && hdrRows('99999999-9999-4999-8999-999999999999') === '0',
  '8a a person with no brokerage, and an id that is nobody, have NO header row');
ok(hdrRows(MEMBER) === '1' && one("select brokerage_name || '|' || agent_name from public.report_header_of(:'u'::uuid)", { u: MEMBER }) === 'Round Trip Realty|Pat Agent',
  '8b an active member of an active brokerage has exactly one row: the account\'s name and their own', one("select brokerage_name || '|' || coalesce(agent_name, '(none)') from public.report_header_of(:'u'::uuid)", { u: MEMBER }));
ok(one("select agent_name is null from public.report_header_of(:'u'::uuid)", { u: LATE }) === 't', '8c a member who has given no name has the brokerage and a null name, not an invented one');
one("update public.brokerage_member set status = 'deactivated' where user_id = :'u'::uuid", { u: LATE });
ok(hdrRows(LATE) === '0', '8d a DEACTIVATED member has no header (the resolver is the only way in)');
one("update public.brokerage_account set status = 'suspended' where name = 'Other Brokerage Realty'");
ok(hdrRows(NEWBIE) === '0', '8e and neither has a member of a SUSPENDED brokerage');
ok(['anon', 'authenticated', 'public'].every((role) => one("select has_function_privilege(:'r', 'public.report_header_of(uuid)', 'execute')", { r: role }) === 'f')
   && one("select has_function_privilege('service_role', 'public.report_header_of(uuid)', 'execute')") === 't',
  '8f the function is executable by the system role alone');
ok(one("select provolatile::text || prosecdef::text from pg_proc where oid = 'public.report_header_of(uuid)'::regprocedure") === 'strue', '8g it is STABLE and SECURITY DEFINER: it can write nothing');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
