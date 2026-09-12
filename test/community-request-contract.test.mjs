// THE FALSE-SUCCESS CONDITION, PINNED — offline.
// Run: node test/community-request-contract.test.mjs
//
// WHY THIS FILE EXISTS. The Add-ZIP modal told every visitor "Request received"
// and captured nobody. Three independent faults stacked (docs/persist-email-caller-audit.md):
//
//   1. it inserted { email, zip } into community_requests; the column is requested_zip
//      (PostgREST answers 400 PGRST204)
//   2. even with the right column, anon has no INSERT grant and RLS has zero policies
//      (PostgREST answers 401 42501)
//   3. persistEmail inspected nothing the caller branched on, so the success state
//      showed UNCONDITIONALLY
//
// Control for the claim: public.community_requests held 5 rows, newest 2026-06-27.
//
// None of the three is visible to a test that only reads source. §1-§6 therefore
// drive the SHIPPED lib/community-request.js against stub clients that reproduce
// each way a Supabase call fails, and §7 proves the assertions are load-bearing by
// running a replica of the OLD implementation through them and requiring it to fail.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require('../lib/community-request.js');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const submit = async (o) => {
  try { return await R.submit(o); }
  catch (e) { return { ok: 'THREW', reason: String((e && e.message) || e) }; }
};

const calls = [];
const client = (behaviour) => ({
  rpc(name, args) {
    calls.push({ name, args });
    return behaviour();
  }
});
const PGRST204 = { data: null, error: { code: 'PGRST204', message: "Could not find the 'zip' column of 'community_requests' in the schema cache" } };
const DENIED   = { data: null, error: { code: '42501', message: 'permission denied for table community_requests' } };
const INVALID  = { data: null, error: { code: '22023', message: 'invalid email' } };
const BADZIP   = { data: null, error: { code: '22023', message: 'invalid zip' } };
const OKNEW    = { data: { ok: true, email: 'a@b.co', zip: '90025' }, error: null };

// ── 1. THE REGRESSION: a resolved { error } is a FAILURE, not a success ──────────────
{
  const r = await submit({ client: client(() => Promise.resolve(PGRST204)), email: 'a@b.co', zip: '90025' });
  ok(r.ok === false, '1a a PostgREST 400 (the shipped bug, verbatim) is NOT success', r);
  const d = await submit({ client: client(() => Promise.resolve(DENIED)), email: 'a@b.co', zip: '90025' });
  ok(d.ok === false, '1b a permission denial is NOT success', d);
  const i = await submit({ client: client(() => Promise.resolve(INVALID)), email: 'a@b.co', zip: '90025' });
  ok(i.ok === false && i.reason === 'invalid_email', '1c a server email rejection surfaces as a field error', i);
  const z = await submit({ client: client(() => Promise.resolve(BADZIP)), email: 'a@b.co', zip: '90025' });
  ok(z.ok === false && z.reason === 'invalid_zip', '1d a server ZIP rejection surfaces as a field error', z);
}

// ── 2. The other two failure shapes ─────────────────────────────────────────────────
{
  const t = await submit({ client: client(() => { throw new Error('offline'); }), email: 'a@b.co', zip: '90025' });
  ok(t.ok === false, '2a a synchronous throw is not success', t);
  const rj = await submit({ client: client(() => Promise.reject(new Error('dns'))), email: 'a@b.co', zip: '90025' });
  ok(rj.ok === false, '2b a rejected promise is not success', rj);
  const u = await submit({ client: client(() => undefined), email: 'a@b.co', zip: '90025' });
  ok(u.ok === false, '2c a client returning nothing is not success', u);
  const n = await submit({ client: client(() => Promise.resolve({ data: null, error: null })), email: 'a@b.co', zip: '90025' });
  ok(n.ok === false, '2d a null payload with no error is STILL not success', n);
  const miss = await submit({ client: null, email: 'a@b.co', zip: '90025' });
  ok(miss.ok === false && miss.reason === 'client_unavailable', '2e no client at all is not success', miss);
}

// ── 3. Success is only an affirmative answer from the canonical store ───────────────
{
  calls.length = 0;
  const r = await submit({ client: client(() => Promise.resolve(OKNEW)), email: '  A@B.CO ', source: 'coverage_modal', zip: '90025' });
  ok(r.ok === true, '3a an affirmative { ok:true } IS success', r);
  ok(calls.length === 1 && calls[0].name === 'hs_community_request_join', '3b it calls the canonical join RPC', calls[0]);
  ok(calls[0].args.p_email === 'a@b.co', '3c the email is trimmed and lowercased before it is stored', calls[0].args);
  ok(calls[0].args.p_zip === '90025' && calls[0].args.p_source === 'coverage_modal', '3d ZIP and source ride along', calls[0].args);
}

// ── 4. A ZIP is required, and never invented ────────────────────────────────────────
{
  calls.length = 0;
  const r = await submit({ client: client(() => Promise.resolve(OKNEW)), email: 'a@b.co', zip: 'Del Valle' });
  ok(r.ok === false && r.reason === 'invalid_zip', '4a an unusable ZIP fails the request', r);
  ok(calls.length === 0, '4b ...and never reaches the network', calls);
  ok(R.normalizeZip('90025') === '90025', '4c a 5-digit ZIP is kept');
  ok(R.normalizeZip('9002') === null && R.normalizeZip('') === null, '4d a malformed ZIP yields none');
}

// ── 5. Invalid input never reaches the network ──────────────────────────────────────
{
  for (const bad of ['', '   ', 'nope', 'a@b', '@b.co', 'a b@c.co', null, undefined]) {
    calls.length = 0;
    const r = await submit({ client: client(() => Promise.resolve(OKNEW)), email: bad, zip: '90025' });
    ok(r.ok === false && calls.length === 0, '5 rejects ' + JSON.stringify(bad) + ' without calling the RPC', r);
  }
}

// ── 6. The dead column is gone from the shipped client, and BOTH handlers BRANCH ────
{
  const shell = readFileSync(join(root, 'shell.js'), 'utf8');
  const lib   = readFileSync(join(root, 'lib/community-request.js'), 'utf8');
  ok(!/from\(['"]community_requests['"]\)/.test(shell) && !/from\(['"]community_requests['"]\)/.test(lib),
    '6a nothing writes community_requests via a table insert any more');
  ok(!/zip:\s*\$\('reqZipLabel'\)/.test(shell) && !/zip:\s*\(onbEl\('onbUncoveredZip'\)/.test(shell),
    '6b the dead `zip` column is no longer sent — the column is requested_zip');

  const loc = (shell.match(/HS\.submitRequest\s*=[\s\S]*?\n  \};/) || [''])[0];
  ok(loc.length > 0, '6c the loc-modal handler is still findable');
  ok(/if\s*\(!res\.ok\)/.test(loc), '6d loc-modal branches on the persistence result');
  const locGuard = loc.indexOf('if (!res.ok)');
  const locDone  = loc.indexOf("$('locDone').classList.remove('hidden')");
  ok(locGuard > -1 && locDone > locGuard, '6e "Request received" is shown only past the loc-modal guard', { locGuard, locDone });

  const onb = (shell.match(/HS\.submitOnboardingRequest\s*=[\s\S]*?\n  \};/) || [''])[0];
  ok(onb.length > 0, '6f the onboarding handler is still findable');
  ok(/if\s*\(!res\.ok\)/.test(onb), '6g onboarding branches on the persistence result');
  const onbGuard = onb.indexOf('if (!res.ok)');
  const onbDone  = onb.indexOf('Request received');
  ok(onbGuard > -1 && onbDone > onbGuard, '6h onboarding success copy is shown only past the guard', { onbGuard, onbDone });

  ok(/RPC\s*=\s*['"]hs_community_request_join['"]/.test(lib),
    '6i the module calls the join RPC by name');

  const acq = readFileSync(join(root, 'acquisition.html'), 'utf8');
  ok(/data-tab="arearequests"/.test(acq) && /14 · Area requests/.test(acq),
    '6j Acquisition Dashboard has tab 14 · Area requests');
  ok(/rpc\('hs_community_requests'/.test(acq),
    '6k the dashboard reads emails through the admin RPC, not a table select');
}

// ── 7. CONTROL: the OLD implementation must FAIL the assertions above ───────────────
{
  const legacy = async (opts) => {
    try { await opts.client.rpc('x', {}); } catch (e) {}
    return { ok: true };
  };
  const l1 = await legacy({ client: client(() => Promise.resolve(PGRST204)) });
  const l2 = await legacy({ client: client(() => { throw new Error('offline'); }) });
  ok(l1.ok === true && l2.ok === true,
    '7a the old code really did report success on a rejection AND on a throw (so §1/§2 are load-bearing)');
}

// ── 8. The parked SQL is the write path the client names, and it is closed ──────────
{
  const sql = readFileSync(join(root, 'docs/community-requests-capture.sql'), 'utf8');
  ok(/create or replace function public\.hs_community_request_join\(/.test(sql),
    '8a the join RPC is in the parked SQL');
  ok(/create or replace function public\.hs_community_requests\(/.test(sql),
    '8b the admin read RPC is in the parked SQL');
  ok(/grant execute on function public\.hs_community_request_join/.test(sql)
     && /to anon, authenticated/.test(sql),
    '8c anon can execute the join');
  ok(/revoke all on function public\.hs_community_requests[\s\S]*from anon/.test(sql),
    '8d anon cannot execute the admin read');
  ok(/revoke all on table public\.community_requests from anon, authenticated/.test(sql),
    '8e public roles hold no table privilege');
  // Comments quote the original 42501 hint ("GRANT INSERT ON … TO anon"). That
  // is the defect this file exists to record, not a grant. Strip comments so
  // the pin reads executable statements only.
  const sqlExec = sql.replace(/--[^\n]*/g, '');
  ok(!/grant insert on (table )?public\.community_requests/i.test(sqlExec),
    '8f the SQL does not restore a public INSERT grant');
  ok(/unique \(email, requested_zip\)/.test(sql),
    '8g one logical request is (email, ZIP), so one person can ask for two ZIPs');
}

console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
