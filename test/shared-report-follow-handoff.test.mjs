// SHARED REPORT "Follow this property" - the hand-off into HomeSignal's existing add-an-address flow. Source-level, offline.
//   The shared page saves nothing and makes no account. The CTA opens index.html#follow=<address>; index.html parks the address in this tab's
//   sessionStorage; shell.js reads it once and runs the SAME flow a typed address runs (sign-in -> Census confirmation -> the resident's Save),
//   whose one writer (savePlaceRow -> app_properties, idempotent by the unique index) is the only thing that creates the relationship.
// Run: node test/shared-report-follow-handoff.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const idx = strip(read('index.html')), shell = strip(read('shell.js')), page = strip(read('shared-report.html'));
const fn = (src, start) => { const i = src.indexOf(start); if (i < 0) return ''; const j = src.indexOf('\n  };', i); return src.slice(i, j < 0 ? i + 3000 : j + 5); };

// 1. index.html: fragment only, validated like #address=, stored for this tab, address bar cleaned, no redirect
const fb = (idx.match(/var follow = [\s\S]*?\n  }\n/) || [''])[0];
ok(/\^#follow=\(\.\+\)\$/.test(fb) && /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(fb), '1a the address is read from the FRAGMENT and removed from the address bar');
ok(/fwanted\.length <= 200 && searchKind\(fwanted\) === 'address'/.test(fb) && /sessionStorage\.setItem\('hs\.followProperty', fwanted\)/.test(fb), '1b only a plausible street address is kept, in this tab\'s sessionStorage');
ok(!/location\.(replace|assign|href)/.test(fb) && !/localStorage/.test(fb), '1c it stays on the page (the shell opens the flow) and writes nothing durable');

// 2. shell.js: one consumer, read once, then the existing flow
const ch = fn(shell, 'HS.consumeFollowHandoff');
ok(/removeItem\('hs\.followProperty'\)/.test(ch) && /HS\.openHome\(want\)/.test(ch) && /want\.length > 200/.test(ch), '2a it reads the key once, removes it in the same step and opens the add-an-address flow');
ok(/HS\.consumeFollowHandoff\(\)/.test(shell.slice(shell.indexOf('HS.startOnboarding();'))), '2b boot calls it, and not in an embed');
const oh = fn(shell, 'HS.openHome = function');
ok(/HS\.openAuth\(want \? function \(\) \{ return HS\.openHome\(want\); \} : undefined\)/.test(oh), '2c signed out: the EXISTING sign-in modal, resuming the same flow after the code');
ok(/a\.value = want; HS\.findHome\(\)/.test(oh), '2d signed in: the address goes through findHome (Census confirmation), so nothing is saved before the resident taps Save');
ok(!/app_properties|app_follows|\.insert\(|\.upsert\(/.test(ch + oh), '2e neither the hand-off nor openHome writes anything: the one writer stays savePlaceRow');
ok((shell.match(/from\('app_properties'\)\.(insert|upsert)/g) || []).length === (read('shell.js').match(/from\('app_properties'\)\.(insert|upsert)/g) || []).length && /async function savePlaceRow/.test(shell), '2f savePlaceRow is still the writer');
ok(/logEvent\('shared_report_follow_clicked'\)/.test(ch) && /logEvent\('shared_report_follow_completed'\)/.test(shell) && !/logEvent\('shared_report_follow_[a-z]+',/.test(shell), '2g the two conversion events are logged through the existing event system, with no payload (no address)');

// 3. shared-report.html: no follow persistence of its own
ok(!/app_follows|app_properties|signInWithOtp|\.auth\b/.test(page), '3a the shared page has no follow, account or sign-in code of its own');
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
