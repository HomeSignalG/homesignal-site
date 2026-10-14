// Jody migration, Step 2 (site half): the backend recognises BOTH origins, derived from the one contract,
// and nothing else changed. Run: node test/brand-origins.test.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { render, CONTRACT_FILE, OUT_FILE, LEGACY_EXTRA_ORIGINS } from '../scripts/gen-brand-origins.mjs';
import { contractHash } from './lib/brand-contract.mjs';
import * as gate from '../supabase/functions/_shared/admin-gate.ts';
import * as gen from '../supabase/functions/_shared/brand-origins.generated.ts';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` — ${why}`}`); if (!ok) failures++; };

const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8'));
const committed = readFileSync(OUT_FILE, 'utf8');

// 1. generated from the contract, not hand-edited
check('1a committed generated file equals a fresh render of the contract', committed === render(contract), 'drift');
check('1b embedded hash equals the contract hash', gen.BRAND_CONTRACT_SHA256 === contractHash(contract) && gen.BRAND_CONTRACT_SHA256 === readFileSync('docs/brand/brand-contract.v1.sha256', 'utf8').trim(), gen.BRAND_CONTRACT_SHA256);
let out = ''; try { execFileSync('node', ['scripts/gen-brand-origins.mjs', '--check'], { stdio: 'pipe' }); out = 'ok'; } catch (e) { out = 'FAILED'; }
check('1c generator --check passes on the committed tree', out === 'ok', out);
const tampered = JSON.parse(JSON.stringify(contract)); tampered.identities.jody.display_name = 'JodyTampered'; // v2 pins the Jody origin, so tamper a field it still allows; the rendered hash must change
check('1d a changed contract renders a DIFFERENT file (the check can fail)', render(tampered) !== committed, 'insensitive');
let threw = false; try { render({ ...contract, contract_version: 9 }); } catch { threw = true; }
check('1e an invalid contract cannot be rendered', threw, 'rendered');

// 2. the allowlist the gate really uses
const want = ['https://jodytracks.com', 'https://www.homesignal.net', 'https://homesignal.net'];  // v2: the current identity first, then the legacy (redirect-only) hosts
check('2a ALLOWED_ORIGINS is exactly the three expected origins, in order', gate.ALLOWED_ORIGINS.join() === want.join(), gate.ALLOWED_ORIGINS.join());
check('2b every pre-existing origin is preserved (additive only)', ['https://homesignal.net', 'https://www.homesignal.net'].every((o) => gate.ALLOWED_ORIGINS.includes(o)), 'lost one');
check('2c the legacy www host is explicit, not inferred', JSON.stringify(LEGACY_EXTRA_ORIGINS) === '["https://www.homesignal.net"]', 'legacy');
check('2d no www host for Jody (least privilege: nothing serves app code there)', !gate.ALLOWED_ORIGINS.includes('https://www.jodytracks.com'), 'www jody');

// 3. CORS behaviour: positive controls for both origins, negatives for lookalikes
const allow = (origin) => gate.corsFor(new Request('https://x/f', { headers: origin ? { origin } : {} }))['Access-Control-Allow-Origin'] ?? null;
for (const o of want) check(`3a ${o} is echoed`, allow(o) === o, String(allow(o)));
for (const o of [
  'https://evil.example', 'http://homesignal.net', 'http://jodytracks.com', 'https://jodytracks.com.evil.example',
  'https://evil-jodytracks.com', 'https://sub.jodytracks.com', 'https://www.jodytracks.com', 'https://JODYTRACKS.com',
  'https://jodytracks.com:8443', 'https://jodytracks.com/', 'null', '*', '',
]) check(`3b lookalike/foreign origin gets no allow-origin: ${JSON.stringify(o)}`, allow(o) === null, String(allow(o)));
check('3c no origin header gets none', allow(null) === null, 'present');
check('3d the header is never a wildcard for any tested origin', [...want, 'https://evil.example'].every((o) => allow(o) !== '*'), 'wildcard');

// 4. authorization does not depend on the origin
const deps = (user, admin) => ({ authenticate: async (t) => (t === 'good' ? user : null), isAdmin: async () => admin });
const reqWith = (origin, token) => new Request('https://x/f', { method: 'POST', headers: { ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const status = async (origin, token, d) => { const r = await gate.authorizeAdmin(reqWith(origin, token), d); return r ? r.status : 'allowed'; };
const user = { email: 'a@example.com', id: 'u1', confirmed: true };
for (const [label, token, d] of [['no token', null, deps(user, true)], ['bad token', 'bad', deps(user, true)], ['non-admin', 'good', deps(user, false)], ['admin (positive control)', 'good', deps(user, true)]]) {
  const results = await Promise.all(['https://homesignal.net', 'https://jodytracks.com', 'https://evil.example', null].map((o) => status(o, token, d)));
  check(`4a ${label}: identical outcome for every origin (${results[0]})`, new Set(results).size === 1, results.join());
}
check('4b the admin positive control is actually allowed', (await status('https://jodytracks.com', 'good', deps(user, true))) === 'allowed', 'denied');
check('4c the unauthenticated control is actually refused', (await status('https://jodytracks.com', null, deps(user, true))) !== 'allowed', 'allowed');

// 5. one source of truth: no second hand-written origin list on the gate, and the generated file has one consumer
const gateSrc = readFileSync('supabase/functions/_shared/admin-gate.ts', 'utf8');
check('5a admin-gate.ts holds no literal origin list', !/https:\/\/(www\.)?(homesignal\.net|jodytracks\.com)/.test(gateSrc.replace(/\/\/.*$/gm, '')), 'literal');
const consumers = execFileSync('git', ['grep', '--untracked', '-l', 'brand-origins.generated', '--', 'supabase', 'scripts', 'lib'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
const WANT_CONSUMERS = ['scripts/gen-brand-origins.mjs', 'supabase/functions/_shared/admin-gate.ts', 'supabase/functions/_shared/billing-reads.ts', 'supabase/functions/_shared/evaluation-reads.ts', 'supabase/functions/_shared/share-reads.ts', 'supabase/functions/_shared/watch-email.ts'].sort();
check('5b only the gate, the four link/sender modules and the generator reference the generated module', JSON.stringify(consumers) === JSON.stringify(WANT_CONSUMERS), consumers.join());

// 6. outbound links: built from the contract's CURRENT identity. While the contract is v1 every emitted string is exactly the one that
// used to be written out in the source (so this deploys with no behaviour change); under the v2 swap they follow the contract.
const genM = await import('../supabase/functions/_shared/brand-origins.generated.ts');
const shareM = await import('../supabase/functions/_shared/share-reads.ts');
const evalM = await import('../supabase/functions/_shared/evaluation-reads.ts');
const billM = await import('../supabase/functions/_shared/billing-reads.ts');
const watchM = await import('../supabase/functions/_shared/watch-email.ts');
const HERE = JSON.parse(readFileSync('docs/brand/brand-contract.v1.json', 'utf8')).current_identity;
check('6a the committed contract is Jody-current (v2), so the emitted values are the Jody ones', HERE === 'jody' && genM.PUBLIC_ORIGIN === 'https://jodytracks.com' && genM.PUBLIC_HOST === 'jodytracks.com' && genM.PUBLIC_NAME === 'Jody', JSON.stringify([HERE, genM.PUBLIC_ORIGIN]));
check('6b SHARE_PAGE is the Jody origin plus the unchanged path', shareM.SHARE_PAGE === 'https://jodytracks.com/shared-report.html', shareM.SHARE_PAGE);
check('6c INVITE_PAGE is the Jody origin plus the unchanged path', evalM.INVITE_PAGE === 'https://jodytracks.com/development-activity-reports.html', evalM.INVITE_PAGE);
check('6d BILLING_PAGE is the Jody origin plus the unchanged path', billM.BILLING_PAGE === 'https://jodytracks.com/development-activity-reports.html#billing', billM.BILLING_PAGE);
check('6e WATCH_FROM and WATCH_OPEN_URL use the Jody identity', watchM.WATCH_FROM === 'Jody <noreply@jodytracks.com>' && watchM.WATCH_OPEN_URL === 'https://jodytracks.com/development-activity-reports.html', watchM.WATCH_FROM);
for (const f of ['share-reads', 'evaluation-reads', 'billing-reads', 'watch-email']) {
  const src = readFileSync(`supabase/functions/_shared/${f}.ts`, 'utf8').replace(/\/\/.*$/gm, '');
  check(`6f ${f}.ts writes no literal homesignal.net/jodytracks.com origin (they come from the contract)`, !/https?:\/\/(www\.)?(homesignal\.net|jodytracks\.com)/.test(src) && !/@homesignal\.net/.test(src), 'literal');
}

if (failures) { console.error(`\n${failures} brand-origins check(s) FAILED`); process.exit(1); }
console.log('\nbrand-origins: all checks passed');
