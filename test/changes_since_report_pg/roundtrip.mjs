// CHANGES SINCE REPORT AND FOLLOW, END TO END ON A REAL DATABASE (contract §6 gate 4; §8.5).
//   Run through: bash test/changes_since_report_pg/run.sh   (it prepares the database and refuses anything not named disposable)
//
// What is real: the ledger tables, the reportable-events view, the private-context layer and the snapshot writer, all applied from
// the SQL of record; the report engine (`assemble`); the snapshot module; the edge function's handler and data layer. What is a
// stand-in: only the transport. `pgrest` below translates the data layer's PostgREST requests into SQL run as role service_role, so
// a grant that production would refuse is refused here, and any request shape it does not know FAILS the run.
import { spawnSync } from 'node:child_process';

const M = await import('../../supabase/functions/_shared/national-report.ts');
const S = await import('../../supabase/functions/_shared/report-snapshot.ts');
const SR = await import('../../supabase/functions/_shared/service-rest.ts');
const CR = await import('../../supabase/functions/_shared/change-reads.ts');
const H = await import('../../supabase/functions/follow-development-report/handler.ts');
const D = await import('../../supabase/functions/follow-development-report/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- psql, as the role PostgREST would use ------------------------------------------------------------------------------------------------
function psql(query, vars = {}, role = null) {
  const args = ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', k + '=' + v);
  const r = spawnSync('psql', [...args, '-f', '-'], { input: (role ? 'set role ' + role + ';\n' : '') + query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const one = (q, v, role = null) => { const r = psql(q, v, role); if (!r.ok) throw new Error('psql: ' + r.err); return r.out; };
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ---- a PostgREST translator: only the request shapes the data layer is known to send --------------------------------------------------------
const TABLES = ['report_snapshot', 'dev_change_project', 'dev_change_event_reportable', 'dev_change_source_fetch_health'];
const requests = [];
function parseIn(v) {
  const m = /^in\.\((.*)\)$/s.exec(v); if (!m) throw new Error('unsupported in-list ' + v);
  const out = []; let i = 0; const s = m[1];
  while (i < s.length) {
    if (s[i] === ',') { i++; continue; }
    if (s[i] !== '"') throw new Error('unquoted in-list value in ' + v);
    let cur = ''; i++;
    while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; cur += s[i]; i++; }
    i++; out.push(cur);
  }
  return out;
}
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
async function pgrest(url, init = {}) {
  try { return await translate(url, init); } catch (e) { console.log('NOTE — the translator refused a request shape: ' + e.message + ' [' + url + ']'); throw e; }
}
async function translate(url, init = {}) {
  const u = new URL(url); requests.push({ path: u.pathname, search: u.search, method: init.method || 'GET' });
  if (u.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer user-token' ? json({ email: 'founder@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' }) : json({ msg: 'no' }, 401);
  if (u.pathname === '/rest/v1/dashboard_admins') return json(u.searchParams.get('email') === 'eq.founder@example.com' ? [{ email: 'founder@example.com' }] : []);
  const rpcM = /^\/rest\/v1\/rpc\/(report_private_context_need_(open|close))$/.exec(u.pathname);
  if (rpcM) {
    const b = JSON.parse(init.body);
    if (!same(Object.keys(b).sort(), ['p_context', 'p_kind', 'p_ref'])) throw new Error('unexpected rpc arguments');
    const r = psql('select public.' + rpcM[1] + "(:'c'::uuid, :'k', :'r');", { c: b.p_context, k: b.p_kind, r: b.p_ref }, 'service_role');
    if (r.ok) return new Response(null, { status: 204 });
    const code = (/ERROR:\s+([0-9A-Z]{5}):/.exec(r.err) || [])[1] || 'XX000';
    return json({ code, message: 'refused' }, 500);
  }
  const t = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
  if (!t || !TABLES.includes(t[1])) return json({ code: 'UNKNOWN', message: 'the translator does not know ' + u.pathname }, 404);
  const cols = u.searchParams.get('select');
  if (!/^[a-z0-9_,]+$/.test(cols || '')) throw new Error('bad select ' + cols);
  const conds = [];
  for (const [k, v] of u.searchParams) {
    if (k === 'select') continue;
    if (!/^[a-z_]+$/.test(k)) throw new Error('bad filter column ' + k);
    if (v.startsWith('eq.')) conds.push(k + ' = ' + lit(v.slice(3)));
    else if (v.startsWith('gt.')) conds.push(k + ' > ' + lit(v.slice(3)));
    else if (v.startsWith('gte.')) conds.push(k + ' >= ' + lit(v.slice(4)));
    else if (v.startsWith('in.')) conds.push(k + ' in (' + parseIn(v).map(lit).join(',') + ')');
    else throw new Error('unsupported filter ' + k + '=' + v);
  }
  const q = 'select coalesce(json_agg(t), \'[]\'::json) from (select ' + cols + ' from public.' + t[1] + (conds.length ? ' where ' + conds.join(' and ') : '') + ') t;';
  const r = psql(q, {}, 'service_role');
  if (!r.ok) { console.log('NOTE — the database refused a translated read: ' + r.err.split('\n').slice(0, 2).join(' | ')); return json({ code: (/ERROR:\s+([0-9A-Z]{5}):/.exec(r.err) || [])[1] || 'XX000', message: r.err.split('\n')[0] }, 400); }
  return new Response(r.out, { status: 200 });
}

// ---- seed the ledger (as the database owner: it is the observation job's table) ------------------------------------------------------------------
const RUN_BASE = '00000000-0000-4000-8000-0000000000b0';
const RUN_ORD = '00000000-0000-4000-8000-0000000000a1';
one(`
  insert into public.dev_change_run (id, baseline, started_at, finished_at) values
    ('${RUN_BASE}', true,  now() - interval '3 days', now() - interval '3 days'),
    ('${RUN_ORD}',  false, now() - interval '1 day',  now() - interval '1 day');
  insert into public.dev_change_project (identity_key, registry_id, key_basis, comparable, facts_version, facts, facts_fp, first_observed_at, last_observed_at, observation_count, zips, first_run_id, last_run_id) values
    ('k1', 'fam-a', 'source_key', true,  1, '{"status":"Approved"}', 'fp-k1', now() - interval '3 days', now() - interval '1 minute', 3, '{97477}', '${RUN_BASE}', '${RUN_ORD}'),
    ('k2', 'fam-a', 'source_key', true,  1, '{"status":"Proposed"}', 'fp-k2', now() - interval '3 days', now() - interval '1 minute', 1, '{97477}', '${RUN_BASE}', '${RUN_BASE}'),
    ('k9', 'fam-a', 'source_key', true,  1, '{"status":"Proposed"}', 'fp-k9', now() - interval '3 days', now() - interval '1 minute', 3, '{97477}', '${RUN_BASE}', '${RUN_ORD}');
`);
/** One ledger event. `observed` and `created` are SQL expressions, so every time is the database's own. */
let seq = 0;
const insertEvent = (o) => one(`
  insert into public.dev_change_event (identity_key, event_type, material, is_baseline, observed_at, prev_facts, new_facts, prev_fp, new_fp, changed_fields,
                                       publisher_event_type, publisher_event_date, source_id, derivation_version, facts_version, run_id, created_at)
  values (${lit(o.key)}, ${lit(o.type || 'status_changed')}, ${o.material === false ? 'false' : 'true'}, false, ${o.observed}, ${lit(JSON.stringify(o.prev || { status: 'Proposed' }))}::jsonb,
          ${lit(JSON.stringify(o.next || { status: 'Approved' }))}::jsonb, 'p${++seq}', 'n${seq}', ${o.fields || "'{status}'"}, null, null, 'fam-a', 1, 1, '${o.run || RUN_ORD}', ${o.created});
`);

const UTC = (expr) => "to_char((" + expr + ") at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
const T0 = new Date(one('select ' + UTC('now()'))); // wall clock, from the database
// events the report CAN see (written before it is issued)
insertEvent({ key: 'k1', observed: "now() - interval '1 day'", created: "now() - interval '1 day'", prev: { status: 'Proposed' }, next: { status: 'Approved' } });               // E0: old, in the body
insertEvent({ key: 'k1', observed: "now() - interval '4 minutes'", created: "now() - interval '3 minutes'", prev: { status: 'Approved' }, next: { status: 'Under review' } }); // E_in: inside the overlap, in the body

// ---- 1. a real report from the real engine, its events read through the real shared reads, stored through the real writer ---------------------
const FAM = 'fam-a';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-09-29', audit_ref: 'fixture', attribution: 'Data: A' }] };
const SUBJECT = { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' };
const SUBJECT2 = { address: '31 Spooner Street Quahog RI', matched_address: '31 SPOONER ST, QUAHOG, RI, 97477', lat: 41.83452, lng: -71.41255, zip: '97477', label: 'Griffin, Peter' };
const proj = (k, x = {}) => ({ source_key: k, registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://example.gov/r/1', ...x });
const radiusRow = (k, d) => ({ source_key: k, feature_id: 'pt:' + k, registry_id: FAM, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false });
const { rest } = SR.makeServiceReads({ url: 'http://pg.test', serviceKey: 'service-key' }, pgrest);
const reads = CR.makeChangeReads(rest);
const keys = ['k1', 'k2'];
const sinceDay = M.addDays(M.dayOf(new Date()), -M.RECENT_DAYS);
const engineLedger = await reads.ledger(keys);
const engineEvents = await reads.events(keys, sinceDay);
ok(engineLedger.length === 2 && engineEvents.length === 2 && engineEvents.every((e) => e.identity_key === 'k1'), '1a the engine\'s inputs are read through the real shared reads from the real view: two ledger rows, the two k1 events written so far', [engineLedger.length, engineEvents.length]);
const assembleFor = (subject) => M.assemble({ now: new Date(), view: 'customer', zip_supported: true, radius_mi: 1, rights: RIGHTS, subject,
  rows: [radiusRow('k1', 0.3), radiusRow('k2', 0.6)], projects: [proj('k1'), proj('k2', { name: 'Weather Station', status: 'Proposed' })], ledger: engineLedger, events: engineEvents, health: [] });
const rpc = async (fn, a) => {
  if (fn !== 'report_snapshot_issue') throw new Error('unexpected rpc ' + fn);
  const r = psql("select row_to_json(t) from public.report_snapshot_issue(:'b', :'h', :'v', :'i'::jsonb, nullif(:'p', '')::jsonb) t;",
    { b: a.p_body, h: a.p_content_hash, v: a.p_report_version, i: JSON.stringify(a.p_engine_inputs), p: a.p_private === null ? '' : JSON.stringify(a.p_private) }, 'service_role');
  if (!r.ok) return { data: null, error: { message: (r.err.match(/ERROR:.*/) || [r.err])[0] } };
  return { data: [JSON.parse(r.out)], error: null };
};
const out1 = assembleFor(SUBJECT), out2 = assembleFor(SUBJECT2);
const env1 = await S.issueSnapshot(rpc, out1.intelligence, out1.privateContext, { reportVersion: M.REPORT_VERSION, engineInputs: out1.engineInputs });
const env2 = await S.issueSnapshot(rpc, out2.intelligence, out2.privateContext, { reportVersion: M.REPORT_VERSION, engineInputs: out2.engineInputs });
const RID = env1.report_id, CTX = env1.private_context_id, RID2 = env2.report_id, CTX2 = env2.private_context_id;
ok(out1.storage_blockers.length === 0 && /^[0-9a-f-]{36}$/.test(RID) && RID !== RID2, '1b two customers\' reports are stored through the real writer (no storage blocker)');
const body1 = JSON.parse(S.snapshotBodyOf(out1.intelligence));
const k1Body = body1.projects.find((p) => p.project_id === 'k1');
ok(k1Body.homesignal_detected_changes.length === 2, '1c the stored body shows k1\'s two changes, E0 and E_in (the report read both from the ledger)', k1Body.homesignal_detected_changes);
const T = new Date(one('select ' + UTC('generated_at') + " from public.report_snapshot where report_id = :'r'::uuid", { r: RID }));
const minutes = (ms) => Math.round(ms / 60000);
ok(Math.abs(T - T0) < 120000, '1d the report was issued at the database\'s own clock, moments after the seed (' + (T - T0) + ' ms)');
ok(one("select count(*) from public.report_private_context_need where context_id = :'c'::uuid and kind = 'report' and closed_at is null", { c: CTX }) === '1', '1e the report holds one open need on its context');

// ---- 2. events the ledger writes AFTER the report is issued --------------------------------------------------------------------------------------
const TS = "(select generated_at from public.report_snapshot where report_id = " + lit(RID) + "::uuid)";
insertEvent({ key: 'k1', observed: TS + " + interval '10 minutes'", created: TS + " + interval '20 minutes'", prev: { status: 'Under review' }, next: { status: 'Operating' } });                  // P1: shown
insertEvent({ key: 'k1', type: 'source_record_updated', material: false, observed: TS + " + interval '11 minutes'", created: TS + " + interval '21 minutes'", prev: { submitted_at: 'a' }, next: { submitted_at: 'b' }, fields: "'{submitted_at}'" }); // P2: non-material
insertEvent({ key: 'k2', observed: TS + " + interval '12 minutes'", created: TS + " + interval '22 minutes'" });                                                                                  // P3: k2 is not change-ready
insertEvent({ key: 'k1', observed: TS + " + interval '13 minutes'", created: TS + " + interval '23 minutes'", run: RUN_BASE, prev: { status: 'Operating' }, next: { status: 'Closed' } });          // P4: written by a BASELINE run
insertEvent({ key: 'k1', observed: TS + " - interval '1 hour'", created: TS + " + interval '30 minutes'", prev: { status: 'Closed' }, next: { status: 'Reopened' } });                              // P5: retrieved BEFORE the report, written AFTER it
insertEvent({ key: 'k9', observed: TS + " + interval '14 minutes'", created: TS + " + interval '24 minutes'" });                                                                                  // P6: a project that was never in the report
insertEvent({ key: 'k1', observed: TS + " + interval '15 minutes'", created: TS + " + interval '3 hours'", prev: { status: 'Reopened' }, next: { status: 'Sold' } });                              // P7: written after "now"
insertEvent({ key: 'k1', observed: TS + " - interval '2 minutes'", created: TS + " - interval '3 minutes'", prev: { status: 'Sold' }, next: { status: 'Stalled' } });                              // E_s: straddles the issue; the report could not see it
insertEvent({ key: 'k1', observed: TS + " - interval '30 minutes'", created: TS + " + interval '40 minutes'", prev: { status: 'Proposed' }, next: { status: 'Approved' } });                          // P8: the new fact is what the report's own card already says (k1 is Approved in the body)

const NOW = new Date(T.getTime() + 2 * 3600 * 1000);
// the follow ids belong to the CALLER: the function mints none. They carry a hex letter so a lower-casing test can fail.
const ids = ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444'];
const handler = H.makeHandler(D.makeDeps({ url: 'http://pg.test', serviceKey: 'service-key', rights: RIGHTS, now: () => NOW }, pgrest));
const responses = [];
const ask = async (body) => {
  const res = await handler(new Request('https://x.supabase.co/functions/v1/follow-development-report', { method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const text = await res.text(); responses.push(text);
  return { status: res.status, json: JSON.parse(text), text };
};

// ---- 3. Changes Since Report, from the real view ---------------------------------------------------------------------------------------------------
const A1 = await ask({ action: 'changes', report_id: RID });
ok(A1.status === 200 && A1.json.status === 'OK', '3a the handler answers a stored report through the real data layer, as role service_role', A1.text.slice(0, 400));
const changed = A1.json.result.changed;
ok(same(changed.map((c) => c.project_id), ['k1']), '3b only k1 changed since the report (k2 is not change-ready; k9 was never in the report)', changed.map((c) => c.project_id));
const rel = changed[0].changes_since_report.map((c) => minutes(Date.parse(c.detected_at) - T.getTime()));
ok(same(rel, [10, -2, -30, -60]), '3c k1\'s four changes, newest source retrieval first: +10 min (P1), -2 min (E_s, straddled the issue), -30 min (P8) and -60 min (P5, retrieved before the report but written after it)', rel);
ok(same(changed[0].changes_since_report.map((c) => c.changes[0].to), ['Operating', 'Stalled', 'Approved', 'Reopened']), '3d and they say what changed to what: Operating, Stalled, Approved, Reopened');
const recorded = changed[0].changes_since_report.map((c) => minutes(Date.parse(c.recorded_at) - T.getTime()));
ok(same(recorded, [20, -3, 40, 30]) && same(changed[0].changes_since_report.map((c) => c.source_retrieved_before_report), [false, true, true, true]),
  '3d2 every entry says when the DATABASE recorded it (+20, -3, +40, +30 min) and whether its source predates the report: only P1 (retrieved after the issue) does not', [recorded, changed[0].changes_since_report.map((c) => c.source_retrieved_before_report)]);
ok(changed[0].lifecycle_at_report.key === 'approved' && changed[0].changes_since_report[2].changes[0].to === 'Approved' && changed[0].changes_since_report[2].source_retrieved_before_report === true
  && A1.json.result.limitations.some((l) => l.code === 'RECORDED_AFTER_REPORT'),
  '3d3 THE REVIEW\'S CASE: the report\'s own card says Approved and the ledger recorded Proposed to Approved after it, from a source retrieved before it: the answer labels it (recorded after, source retrieved before) and carries the limitation instead of presenting it as plainly new', changed[0].lifecycle_at_report);
ok(A1.json.result.excluded.not_change_ready === 1, '3e the k2 event (a project the ledger has seen once) is COUNTED as withheld, not silently dropped', A1.json.result.excluded);
ok(!changed[0].changes_since_report.some((c) => c.changes[0].to === 'Closed'), '3f P4, written by a BASELINE run, is not a change: the reader goes through the reportable view, not the raw table');
ok(!changed[0].changes_since_report.some((c) => c.changes[0].to === 'Sold'), '3g P7, written after "now", is not shown yet');
ok(!changed[0].changes_since_report.some((c) => c.changes[0].to === 'Under review'), '3h E_in, inside the overlap and already in the report\'s body, is NOT repeated');
ok(!changed[0].changes_since_report.some((c) => c.changes[0].field === 'submitted_at'), '3i P2, a non-material update, is not a change');
ok(A1.json.result.limitations.some((l) => l.code === 'NEW_PROJECTS_NOT_COVERED') && A1.json.result.projects_in_report === 2, '3j and the answer says it covers the report\'s projects only');
const ANSWER = JSON.stringify(A1.json.result);

// a REAL failure record for the report's family reaches the answer through the REAL narrow view, and removing it clears it again
ok(!A1.json.result.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'), '3k (control) with no failure record for the family the answer carries no SOURCE_NOT_FULLY_READ');
one("insert into public.dev_refresh_source_failures (zip, registry_id, reason, cached_records, blocked_update, kind) values ('97477', " + lit(FAM) + ", 'timeout', 3, false, 'fetch_failed')");
const AF = await ask({ action: 'changes', report_id: RID });
ok(AF.status === 200 && AF.json.result.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'),
  '3l a fetch failure recorded in the last 24 hours for the report\'s family makes the answer say the source was not fully read (read through the real dev_change_source_fetch_health, as role service_role)', AF.json.result && AF.json.result.limitations);
one("update public.dev_refresh_source_failures set seen_at = now() - interval '3 days'");
const AO = await ask({ action: 'changes', report_id: RID });
ok(!AO.json.result.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'), '3m the same failure three days old is outside the 24-hour window: the limitation is gone');
one("delete from public.dev_refresh_source_failures");

// ---- 4. FOLLOW keeps the context, and Changes Since Report works throughout --------------------------------------------------------------------------
const F1 = await ask({ action: 'follow', report_id: RID, follow_id: ids[0].toUpperCase() });
ok(F1.json.status === 'FOLLOWING' && F1.json.follow_id === ids[0] && ids[0] !== ids[0].toUpperCase(), '4a follow registers the follow the caller named (sent in upper case) through the real database function, and the answer carries it in lower case');
ok(one("select count(*) from public.report_private_context_need where context_id = :'c'::uuid and kind = 'follow' and ref = :'r' and closed_at is null", { c: CTX, r: ids[0] }) === '1', '4b the database holds exactly one open follow need, with the LOWER-case id as its reference (the same id in either case is the same follow)');
const NOID = await ask({ action: 'follow', report_id: RID });
ok(NOID.status === 400 && NOID.json.detail === 'follow_id' && one("select count(*) from public.report_private_context_need where context_id = :'c'::uuid and kind = 'follow'", { c: CTX }) === '1', '4b2 a follow with no follow_id is refused: the function mints none, so no need can be opened that the caller does not hold the id of');
const F1b = await ask({ action: 'follow', report_id: RID, follow_id: ids[0] });
ok(F1b.json.status === 'FOLLOWING' && one("select count(*) from public.report_private_context_need where context_id = :'c'::uuid and kind = 'follow'", { c: CTX }) === '1', '4c following again with the same id is idempotent: still one need');
one("select public.report_private_context_need_close(:'c'::uuid, 'report', :'r')", { c: CTX, r: RID }, 'service_role');
const st = one("select state || '|' || coalesce(purge_due_at::text, 'no-clock') from public.report_private_context where context_id = :'c'::uuid", { c: CTX });
ok(st === 'active|no-clock', '4d the REPORT need closes (the brokerage archives it): the context is STILL active and the 90-day clock has NOT started, because the follow holds it', st);
const A2 = await ask({ action: 'changes', report_id: RID });
ok(JSON.stringify(A2.json.result) === ANSWER, '4e Changes Since Report, asked while only a Follow holds the context, gives the identical answer, byte for byte');
const U1 = await ask({ action: 'unfollow', report_id: RID, follow_id: ids[0] });
ok(U1.json.status === 'UNFOLLOW_REQUESTED', '4f unfollow answers UNFOLLOW_REQUESTED (the database function returns nothing, so the answer cannot claim more); 4g shows it did close the need');
const clock = one("select (purge_due_at - last_needed_at) || '|' || state from public.report_private_context where context_id = :'c'::uuid", { c: CTX });
ok(clock === '90 days|active', '4g the last need closing starts the 90-day clock: exactly 90 days, context still active', clock);
const F2 = await ask({ action: 'follow', report_id: RID, follow_id: ids[1] });
const reopened = one("select coalesce(purge_due_at::text, 'no-clock') from public.report_private_context where context_id = :'c'::uuid", { c: CTX });
ok(F2.json.status === 'FOLLOWING' && reopened === 'no-clock', '4h following again inside the window stops the clock (the context is kept)', [F2.json, reopened]);
const audit = one("select string_agg(kind || coalesce(':' || need_kind, ''), ',' order by event_id) from public.report_private_context_event where context_id = :'c'::uuid", { c: CTX });
ok(audit === 'created,need_opened:report,need_opened:follow,need_closed:report,need_closed:follow,grace_started,need_opened:follow,grace_cleared', '4i the audit log tells the story in order, with need KINDS and no reference or value', audit);

// ---- 4j. several follows, replays and ids that were never opened: what the database does with them, observed ---------------------------------------------------
// ids[1] is open here (4h). These pin the behaviour the follow doc §7 lists as limits, so a change to it has to be made on purpose.
{
  const needs = (ref) => one("select count(*) filter (where closed_at is null) || '/' || count(*) from public.report_private_context_need where context_id = :'c'::uuid and kind = 'follow' and ref = :'r'", { c: CTX, r: ref });
  const state = () => one("select state || '|' || coalesce((purge_due_at - last_needed_at)::text, 'no-clock') from public.report_private_context where context_id = :'c'::uuid", { c: CTX });
  const NEVER = 'a5555555-5555-4555-8555-555555555555';
  await ask({ action: 'follow', report_id: RID, follow_id: ids[3] });
  ok(needs(ids[1]) === '1/1' && needs(ids[3]) === '1/1' && state() === 'active|no-clock', '4j1 two follows are open at once, each with its own need, and the clock is stopped', [needs(ids[1]), needs(ids[3]), state()]);
  await ask({ action: 'unfollow', report_id: RID, follow_id: ids[1] });
  ok(needs(ids[1]) === '0/1' && state() === 'active|no-clock', '4j2 closing ONE of two follows leaves the context held and the clock stopped: the other follow still needs it', [needs(ids[1]), state()]);
  const UN = await ask({ action: 'unfollow', report_id: RID, follow_id: NEVER });
  ok(UN.json.status === 'UNFOLLOW_REQUESTED' && needs(NEVER) === '0/0' && needs(ids[3]) === '1/1' && state() === 'active|no-clock',
    '4j3 an unfollow of an id that was NEVER opened changes nothing (no need created, the real follow still open) and is answered UNFOLLOW_REQUESTED, not "done"', [UN.json.status, needs(NEVER), state()]);
  await ask({ action: 'unfollow', report_id: RID, follow_id: ids[3] });
  ok(state() === 'active|90 days', '4j4 closing the LAST follow starts the 90-day clock', state());
  await ask({ action: 'follow', report_id: RID, follow_id: ids[1] });
  ok(needs(ids[1]) === '1/2' && state() === 'active|no-clock', '4j5 DOCUMENTED LIMIT: a follow replayed AFTER its unfollow opens a second need on the same id and stops the clock again; the last request to arrive wins, not the caller\'s last intent', [needs(ids[1]), state()]);
  await ask({ action: 'unfollow', report_id: RID, follow_id: ids[1] });
  ok(needs(ids[1]) === '0/2' && state() === 'active|90 days', '4j6 and one more unfollow of that id closes it again and restarts the clock', [needs(ids[1]), state()]);
  await ask({ action: 'follow', report_id: RID, follow_id: ids[1] });   // leave a follow open, as sections 5+ expect
}

// ---- 5. THE PURGE: the answer does not change, because the reader never touched the private context --------------------------------------------------
one("select public.report_private_context_purge(:'c'::uuid, 'verified_privacy_request')", { c: CTX }, 'service_role');
const purged = one("select state || '|' || coalesce(address, 'NULL') || '|' || coalesce(latitude::text, 'NULL') from public.report_private_context where context_id = :'c'::uuid", { c: CTX });
ok(purged === 'purged|NULL|NULL', '5a a verified privacy request purges the context in place (address and coordinates are gone)', purged);
const A3 = await ask({ action: 'changes', report_id: RID });
ok(JSON.stringify(A3.json.result) === ANSWER, '5b Changes Since Report after the purge gives the SAME answer, byte for byte: it never depended on the private context');
const F3 = await ask({ action: 'follow', report_id: RID, follow_id: ids[2] });
ok(F3.status === 200 && F3.json.status === 'CONTEXT_PURGED' && F3.json.follow_id === undefined, '5c following a purged report says CONTEXT_PURGED (the database\'s own 55000, translated): a purge is terminal');
const U2 = await ask({ action: 'unfollow', report_id: RID, follow_id: ids[0] });
ok(U2.status === 200 && U2.json.status === 'UNFOLLOW_REQUESTED', '5d unfollowing a purged report is a harmless no-op');
ok(one("select count(*) from public.report_snapshot where report_id = :'r'::uuid and private_context_id = :'c'::uuid", { r: RID, c: CTX }) === '1', '5e the snapshot still points at the tombstone: nothing permanent was damaged');
ok(one("select state from public.report_private_context where context_id = :'c'::uuid", { c: CTX2 }) === 'active' && one("select address from public.report_private_context where context_id = :'c'::uuid", { c: CTX2 }) === SUBJECT2.address, '5f the OTHER customer\'s context is untouched by all of it');
const A4 = await ask({ action: 'changes', report_id: RID2 });
ok(A4.json.status === 'OK' && A4.json.result.changed.length === 1 && A4.json.result.report.report_id === RID2, '5g the other customer\'s report answers normally: the same permanent body, its own report id');

// ---- 6. nothing private came out, and the data layer never went near it ----------------------------------------------------------------------------------
{
  const norm = (t) => String(t).toLowerCase().replace(/[\s,.]+/g, ' ').trim();
  const priv = [SUBJECT, SUBJECT2].flatMap((s) => [s.address, s.matched_address, s.label]);
  const frags = [SUBJECT, SUBJECT2].flatMap((s) => M.addressFragments(s.address).map((f) => f.text));
  const all = norm(responses.join('\n'));
  const leaks = [...priv, ...frags].filter((v) => all.includes(norm(v)));
  ok(priv.length === 6 && frags.length >= 4 && responses.length >= 10, '6a (control) the scan covers 6 private values, at least 4 fragments and ' + responses.length + ' responses');
  ok(leaks.length === 0, '6b NONE of them is in any response of this run', leaks);
  ok(![CTX, CTX2].some((c) => responses.join('').includes(c)), '6c and neither context id is in any response');
  ok(!/44\.04612|122\.98123|41\.83452|71\.41255/.test(responses.join('')), '6d no coordinate either');
  const tables = [...new Set(requests.map((r) => r.path.replace('/rest/v1/', '').replace('rpc/', 'rpc:')))].sort();
  ok(same(tables, ['/auth/v1/user', 'dashboard_admins', 'dev_change_event_reportable', 'dev_change_project', 'dev_change_source_fetch_health', 'report_snapshot', 'rpc:report_private_context_need_close', 'rpc:report_private_context_need_open']), '6e the data layer\'s whole footprint: the ledger, the view, the snapshot, the allow-list and the two need functions. Never the private context', tables);
  const selects = (pred) => [...new Set(requests.filter(pred).map((r) => new URL('http://x' + r.path + r.search).searchParams.get('select')))].sort();
  ok(same(selects((r) => r.path.endsWith('/report_snapshot')), ['private_context_id', 'report_id,content_hash,report_version,generated_at,body']),
    '6e2 the snapshot was read in exactly two ways: the body and identity (no private-context column), and the handle alone (no body)', selects((r) => r.path.endsWith('/report_snapshot')));
  const sinceReads = requests.filter((r) => r.path.endsWith('/dev_change_event_reportable') && r.search.includes('created_at=gt.'));
  ok(sinceReads.length >= 4 && sinceReads.every((r) => r.search.includes('material=eq.true')), '6e3 every Changes Since Report read of the ledger asked for material events only (' + sinceReads.length + ' reads)', sinceReads.length);
  const denied = psql('select address from public.report_private_context limit 1;', {}, 'service_role');
  ok(!denied.ok && /permission denied/.test(denied.err), '6f (control) as service_role the private table CANNOT be read directly: the data layer could not have read it by accident');
  const read = psql("select * from public.report_private_context_read(:'c'::uuid)", { c: CTX2 }, 'service_role');
  ok(read.ok && read.out.includes(SUBJECT2.address), '6g (control) the one function that returns the address does work for service_role, so 6e\'s absence of it is a choice made by the code');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
