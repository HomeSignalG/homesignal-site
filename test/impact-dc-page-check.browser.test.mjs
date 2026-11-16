// TAB 17 project check: the page checker (scripts/lib/impact-dc-page-check.mjs) in a real Chromium, against stand-in pages
// that end the way Map 1 can end: the project focused with its panel open, a notice, another project, a closed panel, an error.
// Run: node test/impact-dc-page-check.browser.test.mjs
import http from 'node:http';
import { checkProjectPage } from '../scripts/lib/impact-dc-page-check.mjs';

let fails = 0;
const ok = (c, name, extra) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); if (!c) fails++; };
let pw;
try { pw = await import('playwright'); } catch { console.log('SKIP — playwright is not installed'); process.exit(process.env.CI ? 1 : 0); }

const page = (script, panel) => `<!doctype html><meta charset=utf-8><section id="projPanel" ${panel}>CyrusOne Vint Hill · Status on JODY</section>
<script>setTimeout(function(){ ${script} }, 50);</script>`;
const PAGES = {
  '/good': page("window.__HS_PROJECT_FOCUS = { key: 'dcrec:a', mapKey: 'dc:aaa', zip: '20187' };", ''),
  '/notice': page("window.__HS_PROJECT_NOTICE = 'not_on_map';", ''),
  '/other': page("window.__HS_PROJECT_FOCUS = { key: 'dcrec:a', mapKey: 'dc:zzz', zip: '20187' };", ''),
  '/closed': page("window.__HS_PROJECT_FOCUS = { key: 'dcrec:a', mapKey: 'dc:aaa', zip: '20187' };", 'hidden'),
  '/phone-only-closed': page("window.__HS_PROJECT_FOCUS = { key: 'dcrec:a', mapKey: 'dc:aaa' }; if (innerWidth < 500) document.getElementById('projPanel').hidden = true;", ''),
};
const server = http.createServer((q, s) => {
  if (q.url === '/boom') { s.writeHead(503); return s.end('down'); }
  const b = PAGES[q.url.split('?')[0]];
  if (!b) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'content-type': 'text/html' }); s.end(b);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const exp = { mapKey: 'dc:aaa', name: 'CyrusOne Vint Hill' };
const o = { timeout: 5000 };

let r = await checkProjectPage(base + '/good', exp, o);
ok(r.state === 'verified' && r.checks.length === 2 && r.checks.every((c) => c.ok), '1 the project focused with its panel open, at desktop and phone width', r);
r = await checkProjectPage(base + '/notice', exp, o);
ok(r.state === 'mismatch' && /not_on_map/.test(r.error), '2 a notice is reported, never verified', r);
r = await checkProjectPage(base + '/other', exp, o);
ok(r.state === 'mismatch' && /different project/.test(r.error), '3 another project is reported', r);
r = await checkProjectPage(base + '/closed', exp, o);
ok(r.state === 'mismatch' && /panel did not open/.test(r.error), '4 a closed panel is reported', r);
r = await checkProjectPage(base + '/phone-only-closed', exp, o);
ok(r.state === 'mismatch' && r.checks[0].ok && !r.checks[1].ok && /^phone:/.test(r.error), '5 a failure at phone width alone is a failure', r);
r = await checkProjectPage(base + '/good', { mapKey: 'dc:aaa', name: 'Some Other Name' }, o);
ok(r.state === 'mismatch' && /does not name/.test(r.error), '6 a panel that does not name the project is reported', r);
r = await checkProjectPage(base + '/boom', exp, o);
ok(r.state === 'error' && /HTTP 503/.test(r.error), '7 a server error is an error (the check could not run), not a mismatch', r);

server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
