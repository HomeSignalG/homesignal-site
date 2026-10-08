// An email the person has not proved they own never reaches the admin allow-list or a trial (audit fix 11, 2026-10-07).
// Today Supabase "Confirm email" is OFF but every account is confirmed (read-only check, 2026-10-07), so nothing is exploitable; this closes it in code.
import { readFileSync } from 'node:fs';
const G = await import('../supabase/functions/_shared/admin-gate.ts');
const R = await import('../supabase/functions/_shared/service-rest.ts');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const UID = '11111111-2222-3333-4444-555555555555';
const req = () => new Request('https://x.test/', { method: 'POST', headers: { authorization: 'Bearer tok', origin: 'https://homesignal.net' } });

// 1. the real reader: confirmed only when the auth service says so
function reader(user) {
  const f = async (url) => url.includes('/auth/v1/user') ? new Response(JSON.stringify(user), { status: 200 }) : new Response('[]', { status: 200 });
  return R.makeServiceReads({ url: 'https://p.test', serviceKey: 'k' }, f).authenticate;
}
const a1 = await reader({ id: UID, email: 'a@b.co', email_confirmed_at: '2026-10-01T00:00:00Z' })('t');
ok(a1 && a1.confirmed === true && a1.email === 'a@b.co' && a1.id === UID, '1a a confirmed email reads as confirmed');
ok((await reader({ id: UID, email: 'a@b.co', email_confirmed_at: null })('t')).confirmed === false, '1b email_confirmed_at null reads as NOT confirmed');
ok((await reader({ id: UID, email: 'a@b.co' })('t')).confirmed === false, '1c email_confirmed_at absent reads as NOT confirmed (fails closed)');
ok((await reader({ id: UID, email: 'a@b.co', email_confirmed_at: '' })('t')).confirmed === false, '1d an empty value reads as NOT confirmed');
ok((await reader({ id: UID, email: 'a@b.co', email_confirmed_at: true })('t')).confirmed === false, '1e a non-text value reads as NOT confirmed');

// 2. the gate: an unconfirmed person is refused before the allow-list or a trial is asked
const asked = [];
const deps = (user) => ({
  authenticate: async () => user,
  isAdmin: async (e) => { asked.push('admin'); return e.startsWith('admin'); },
  trialOf: async () => { asked.push('trial'); return { status: 'active', credits_used: 0, credits_remaining: 10, expired: false }; },
});
for (const [name, fn] of [['authorizeAdmin', G.authorizeAdmin], ['authorizeReportCaller', G.authorizeReportCaller], ['authorizeSignedIn', G.authorizeSignedIn]]) {
  asked.length = 0;
  const r = await fn(req(), deps({ email: 'admin@x.co', id: UID, confirmed: false }));
  ok(r instanceof Response && r.status === 401 && asked.length === 0, '2a ' + name + ': unconfirmed → 401, and neither the allow-list nor a trial was asked', { status: r && r.status, asked });
}
asked.length = 0;
const okAdmin = await G.authorizeAdmin(req(), deps({ email: 'admin@x.co', id: UID, confirmed: true }));
ok(okAdmin === null && asked.includes('admin'), '2b a confirmed admin still passes');
const okTrial = await G.authorizeReportCaller(req(), deps({ email: 'm@x.co', id: UID, confirmed: true }));
ok(okTrial && okTrial.kind === 'trial', '2c a confirmed trial member still passes');
asked.length = 0;
const noField = await G.authorizeAdmin(req(), deps({ email: 'admin@x.co', id: UID }));
ok(noField === null, '2d a stand-in that supplies no field is unchanged (only the real reader sets it, and it fails closed)');

// 3. wiring: the one real reader is what every function uses
const rest = readFileSync('supabase/functions/_shared/service-rest.ts', 'utf8');
ok(/email_confirmed_at/.test(rest) && /confirmed/.test(readFileSync('supabase/functions/_shared/admin-gate.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '')), '3a both halves name the field');
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
