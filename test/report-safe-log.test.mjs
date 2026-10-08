// The report and billing functions write ONE fixed-text line per request (audit fix 9, 2026-10-07): name, status, milliseconds, and "threw".
// Never an address, a share-link token, an email, an error message or a body. Proved on the shipped module, then on the three wiring files.
import { readFileSync } from 'node:fs';
const { safeLogLine, withSafeLog } = await import('../supabase/functions/_shared/safe-log.ts');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

// 1. the line
ok(safeLogLine('manage-billing', 200, 12.4, false) === '[manage-billing] status=200 ms=12', '1a a normal line');
ok(safeLogLine('x', null, 5, true) === '[x] status=none ms=5 threw', '1b a throw has no status and says so');
ok(safeLogLine('x', 99999, 5, false) === '[x] status=none ms=5' && safeLogLine('x', 200.5, 5, false) === '[x] status=none ms=5', '1c an impossible status never prints');
ok(safeLogLine('a b\n742 Evergreen Terrace', 200, NaN, false) === '[ab742EvergreenTerrace] status=200 ms=0', '1d the name is cut to letters, digits and dashes: a caller cannot smuggle text through it');
ok(!/\s{2,}|\n/.test(safeLogLine('x\ny', 200, 1, false)), '1e one line, always');

// 2. the wrapper logs once and never changes the answer
const lines = [];
let t = 100;
const now = () => (t += 7);
const secretReq = new Request('https://x.test/functions/v1/view-shared-report?token=SECRETTOKEN', { method: 'POST', headers: { authorization: 'Bearer SECRETJWT' }, body: JSON.stringify({ address: '742 Evergreen Terrace, Springfield', label: 'Client Jones' }) });
const res = new Response('{"address":"742 Evergreen Terrace","email":"a@b.co"}', { status: 429 });
const out = await withSafeLog('get-development-activity-report', async () => res, (l) => lines.push(l), now)(secretReq);
ok(out === res && out.status === 429, '2a the answer is returned untouched');
ok(lines.length === 1 && lines[0] === '[get-development-activity-report] status=429 ms=7', '2b exactly one line', lines);
ok(!/SECRET|Evergreen|Jones|@|Bearer/.test(lines.join('\n')), '2c nothing from the request or the answer reaches the line');

// 3. a throw is logged once and still thrown
const l2 = [];
let threw = null;
try { await withSafeLog('manage-billing', async () => { throw new Error('boom 742 Evergreen Terrace a@b.co'); }, (l) => l2.push(l), now)(secretReq); } catch (e) { threw = e; }
ok(threw && /boom/.test(threw.message), '3a the error still reaches the platform');
ok(l2.length === 1 && l2[0] === '[manage-billing] status=none ms=7 threw' && !/boom|Evergreen|@/.test(l2[0]), '3b the line says "threw" and nothing about why', l2);

// 4. a broken sink never changes the answer
let r4 = null;
try { r4 = await withSafeLog('x', async () => new Response('', { status: 200 }), () => { throw new Error('sink down'); }, now)(secretReq); } catch (e) { r4 = e; }
ok(r4 instanceof Response && r4.status === 200, '4a a failing log sink does not fail the request');
let t4 = null;
try { await withSafeLog('x', async () => { throw new Error('h'); }, () => { throw new Error('sink down'); }, now)(secretReq); } catch (e) { t4 = e; }
ok(t4 && t4.message === 'h', '4b a failing sink does not replace the handler error');

// 5. the wiring: the three functions are wrapped, and nothing else in them logs
const FN = 'supabase/functions/';
for (const f of ['get-development-activity-report', 'development-activity-billing-webhook', 'manage-billing']) {
  const idx = readFileSync(FN + f + '/index.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  ok(new RegExp("Deno\\.serve\\(withSafeLog\\('" + f + "',").test(idx) && /_shared\/safe-log\.ts/.test(idx), '5a ' + f + ': the served handler is wrapped');
  ok((idx.match(/console\./g) || []).length === 1 && /\(line\) => console\.log\(line\)/.test(idx), '5b ' + f + ': the only console call passes the fixed line');
  for (const g of ['handler.ts', 'data.ts']) ok(!/\bconsole\./.test(readFileSync(FN + f + '/' + g, 'utf8').replace(/^\s*\/\/.*$/gm, '')), '5c ' + f + '/' + g + ' does not log');
}
const mod = readFileSync(FN + '_shared/safe-log.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '');
ok(!/\bconsole\.|Deno\b|req\.(url|headers|json|text|body)|res\.(json|text|body)|\.message/.test(mod), '5d the module touches no global and never reads a request or an answer beyond its status');
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
