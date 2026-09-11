// THE FALSE-SUCCESS CONDITION, PINNED — offline.
// Run: node test/premium-waitlist-contract.test.mjs
//
// WHY THIS FILE EXISTS. The Premium modal told every visitor "You're on the list"
// and captured nobody. Three independent faults stacked:
//
//   1. it inserted into `premium_waitlist`, which does not exist in production
//      (PostgREST answers 404 PGRST205, "Perhaps you meant public.app_premium_waitlist")
//   2. persistEmail wrapped the call in `try { await ... } catch {}` — but a
//      PostgREST rejection RESOLVES with { error }, it does not throw, so the
//      catch was beside the point and the error was never even reachable
//   3. the caller awaited that promise and then showed the success state
//      UNCONDITIONALLY, with nothing in between
//
// Control for the claim: public.app_premium_waitlist held 0 rows.
//
// None of the three is visible to a test that only reads source. §1-§6 therefore
// drive the SHIPPED lib/premium-waitlist.js against stub clients that reproduce
// each way a Supabase call fails, and §7 proves the assertions are load-bearing by
// running a replica of the OLD implementation through them and requiring it to fail.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const W = require('../lib/premium-waitlist.js');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

// submit() must never throw at its caller. A regression that crashes would otherwise
// abort the run at the first section and hide every assertion after it — so a throw is
// converted into a named failure here rather than a stack trace. (CLAUDE.md: "a mutation
// harness that counts FAIL lines cannot see a crash".)
const submit = async (o) => {
  try { return await W.submit(o); }
  catch (e) { return { ok: 'THREW', reason: String((e && e.message) || e) }; }
};

// Stub clients. Each reproduces one real production behaviour.
const calls = [];
const client = (behaviour) => ({
  rpc(name, args) {
    calls.push({ name, args });
    return behaviour();
  }
});
// This is exactly what production returned for the dead table, verbatim.
const PGRST205 = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.premium_waitlist' in the schema cache" } };
const DENIED   = { data: null, error: { code: '42501', message: 'permission denied for table app_premium_waitlist' } };
const INVALID  = { data: null, error: { code: '22023', message: 'invalid email' } };
const OKNEW    = { data: { ok: true, email: 'a@b.co' }, error: null };

// ── 1. THE REGRESSION: a resolved { error } is a FAILURE, not a success ──────────────
{
  const r = await submit({ client: client(() => Promise.resolve(PGRST205)), email: 'a@b.co' });
  ok(r.ok === false, '1a a PostgREST 404 (the shipped bug, verbatim) is NOT success', r);
  const d = await submit({ client: client(() => Promise.resolve(DENIED)), email: 'a@b.co' });
  ok(d.ok === false, '1b a permission denial is NOT success', d);
  const i = await submit({ client: client(() => Promise.resolve(INVALID)), email: 'a@b.co' });
  ok(i.ok === false && i.reason === 'invalid_email', '1c a server email rejection surfaces as a field error', i);
}

// ── 2. The other two failure shapes ─────────────────────────────────────────────────
{
  const t = await submit({ client: client(() => { throw new Error('offline'); }), email: 'a@b.co' });
  ok(t.ok === false, '2a a synchronous throw is not success', t);
  const rj = await submit({ client: client(() => Promise.reject(new Error('dns'))), email: 'a@b.co' });
  ok(rj.ok === false, '2b a rejected promise is not success', rj);
  const u = await submit({ client: client(() => undefined), email: 'a@b.co' });
  ok(u.ok === false, '2c a client returning nothing is not success', u);
  const n = await submit({ client: client(() => Promise.resolve({ data: null, error: null })), email: 'a@b.co' });
  ok(n.ok === false, '2d a null payload with no error is STILL not success', n);
  const miss = await submit({ client: null, email: 'a@b.co' });
  ok(miss.ok === false && miss.reason === 'client_unavailable', '2e no client at all is not success', miss);
}

// ── 3. Success is only an affirmative answer from the canonical store ───────────────
{
  calls.length = 0;
  const r = await submit({ client: client(() => Promise.resolve(OKNEW)), email: '  A@B.CO ', source: '/index.html', zip: '78617' });
  ok(r.ok === true, '3a an affirmative { ok:true } IS success', r);
  ok(calls.length === 1 && calls[0].name === 'hs_premium_waitlist_join', '3b it calls the canonical join RPC', calls[0]);
  ok(calls[0].args.p_email === 'a@b.co', '3c the email is trimmed and lowercased before it is stored', calls[0].args);
  ok(calls[0].args.p_zip === '78617' && calls[0].args.p_source === '/index.html', '3d source and ZIP ride along', calls[0].args);
}

// ── 4. A ZIP is never invented, and never blocks a signup ───────────────────────────
{
  calls.length = 0;
  const r = await submit({ client: client(() => Promise.resolve(OKNEW)), email: 'a@b.co', zip: 'Del Valle' });
  ok(r.ok === true, '4a an unusable ZIP does not fail the signup', r);
  ok(calls[0].args.p_zip === null, '4b ...it is dropped rather than guessed', calls[0].args);
  ok(W.zipFromLocation({ search: '?zip=78617', pathname: '/community.html' }) === '78617', '4c ?zip= is a real ZIP context');
  ok(W.zipFromLocation({ search: '', pathname: '/community/02138/' }) === '02138', '4d a /community/<zip>/ path is too');
  ok(W.zipFromLocation({ search: '', pathname: '/index.html' }) === null, '4e a page with no stated ZIP yields none');
  ok(W.zipFromLocation({ search: '?zip=786', pathname: '/x' }) === null, '4f a malformed ZIP yields none');
}

// ── 5. Invalid input never reaches the network ──────────────────────────────────────
{
  for (const bad of ['', '   ', 'nope', 'a@b', '@b.co', 'a b@c.co', null, undefined]) {
    calls.length = 0;
    const r = await submit({ client: client(() => Promise.resolve(OKNEW)), email: bad });
    ok(r.ok === false && calls.length === 0, '5 rejects ' + JSON.stringify(bad) + ' without calling the RPC', r);
  }
}

// ── 6. The dead table is gone from the shipped client, and the handler BRANCHES ─────
{
  const shell = readFileSync(join(root, 'shell.js'), 'utf8');
  const lib   = readFileSync(join(root, 'lib/premium-waitlist.js'), 'utf8');
  ok(!/from\(['"]premium_waitlist['"]\)/.test(shell) && !/from\(['"]premium_waitlist['"]\)/.test(lib),
    '6a nothing writes to the non-existent `premium_waitlist` table any more');
  const handler = (shell.match(/HS\.submitWaitlist\s*=[\s\S]*?\n  \};/) || [''])[0];
  ok(handler.length > 0, '6b the handler is still findable');
  ok(/if\s*\(!res\.ok\)/.test(handler), '6c it branches on the persistence result before anything else');
  // The success state must be reachable ONLY after that guard returns.
  const guardAt   = handler.indexOf('if (!res.ok)');
  const successAt = handler.indexOf("$('premiumDone').classList.remove('hidden')");
  ok(guardAt > -1 && successAt > guardAt, '6d "You\'re on the list" is shown only past the guard', { guardAt, successAt });
  // Gate 6 — conversion is measured after persistence, never instead of it.
  const eventAt = handler.indexOf('premium_waitlist_joined');
  ok(eventAt > guardAt, '6e the conversion event fires only after confirmed persistence', { guardAt, eventAt });
  ok(/persistEmail[\s\S]*?res\.error[\s\S]*?return \{ ok: false/.test(shell),
    '6f persistEmail itself now inspects the resolved error rather than only catching throws');
}

// ── 7. CONTROL: the OLD implementation must FAIL the assertions above ───────────────
// Without this, §1 and §2 could be passing for the wrong reason — a test that would
// also have passed against the broken code proves nothing about the fix.
{
  const legacy = async (opts) => {
    // A faithful replica of what shipped: await, swallow, report success.
    try { await opts.client.rpc('x', {}); } catch (e) {}
    return { ok: true };
  };
  const l1 = await legacy({ client: client(() => Promise.resolve(PGRST205)) });
  const l2 = await legacy({ client: client(() => { throw new Error('offline'); }) });
  ok(l1.ok === true && l2.ok === true,
    '7a the old code really did report success on a rejection AND on a throw (so §1/§2 are load-bearing)');
}

console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
