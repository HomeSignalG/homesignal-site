// Tab 20 · Weekly Report, STAGE 1 offline prototype: wiring, topic list, titles, and "nothing here is connected".
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

let fails = 0;
function ok(c, m) { if (c) console.log('PASS — ' + m); else { fails++; console.log('FAIL — ' + m); } }
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const key = (p) => createHash('sha256').update(readFileSync(new URL('../' + p, import.meta.url))).digest('hex').slice(0, 8);
const html = read('acquisition.html');
const js = read('lib/acq-weekly-report.js');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 1. the shell
const nav = html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/)[1];
const labels = [...nav.matchAll(/data-tab="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
ok(labels.length === 20, '1a the dashboard has exactly 20 tabs');
ok(labels[19][0] === 'weeklyreport' && labels[19][1] === '20 · Weekly Report', '1b tab 20 is "20 · Weekly Report"');
ok(labels.filter((l) => l[0] === 'weeklyreport').length === 1 && (html.match(/id="tab-weeklyreport"/g) || []).length === 1, '1c tab 20 and its container appear exactly once');
ok(labels[16][0] === 'impactstories' && labels[18][0] === 'claimcheck', '1d tabs 17-19 keep their places');
ok(/weeklyreport: function \(\) \{[\s\S]*?HS\.acqWeeklyReport\.load\(window\.hsClient, el\)/.test(html), '1e a trusted initializer loads the module');
ok(/if\(id==='weeklyreport'\) return;/.test(html), '1f a snapshot refresh never overwrites the tab');
ok(html.includes('<script src="topics.js?v=' + key('topics.js') + '"></script>'), '1g topics.js is loaded with its content key');
ok(html.includes('<script src="lib/acq-weekly-report.js?v=' + key('lib/acq-weekly-report.js') + '"></script>'), '1h the module is loaded with its content key');
ok(html.indexOf('topics.js?v=') < html.indexOf('lib/acq-weekly-report.js?v='), '1i topics.js loads before the module');

// 2. nothing in Stage 1 is connected
for (const [re, what] of [[/\.rpc\s*\(/, 'database function calls'], [/\bfetch\s*\(/, 'fetch'], [/storage\s*\.\s*from/, 'storage'],
  [/\.from\s*\(\s*['"]/, 'table reads'], [/XMLHttpRequest|sendBeacon|WebSocket|EventSource/, 'other network calls'],
  [/\beval\s*\(|new\s+Function\s*\(/, 'eval']]) ok(!re.test(code), '2 no ' + what);
ok(/<button type="button" id="wr-render" disabled>/.test(code) && !/wr-render[^']*'\)\.disabled\s*=\s*false/.test(code), '2b the render button is always disabled');
ok(/'Remotion licence[^']*', false/.test(code) && /'Render job connected', false/.test(code), '2c the licence and render-job gates are hard-coded off');

// 3. the topic list is the Local News catalog, not a copy
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
vm.runInContext(read('topics.js'), ctx); vm.runInContext(js, ctx);
const topics = Array.from(ctx.window.HS.universalTopics);
const seeds = [...read('docs/alert-subscription-canonical-a1.sql').matchAll(/\('news','([^']+)'\)/g), ...read('docs/alert-subscription-canonical-a13.sql').matchAll(/values \('news', '([^']+)'/g)].map((m) => m[1]);
ok(topics.length === 13 && new Set(topics).size === 13, '3a 13 topics');
ok(JSON.stringify([...topics].sort()) === JSON.stringify([...new Set(seeds)].sort()), '3b they equal the alert_topic_catalog news seeds exactly');
ok(!/'Soil Quality'|'EMF'|'Radiation'|'Infrastructure'|'Light Pollution'|'Noise Pollution'|'Development & Land Use'/.test(code), '3c the module names no topic outside its three title/start constants (no per-topic code)');

// 4. titles
const W = ctx.window.HS.acqWeeklyReport;
ok(W.SERIES === 'QUALITY-of-LIFE Weekly Report', '4a series name');
ok(W.thumbnailTitle('Data Centers') === 'QUALITY-of-LIFE Weekly Report : Data Centers', '4b Data Centers title');
ok(W.thumbnailTitle('Air Quality') === 'QUALITY-of-LIFE Weekly Report : Air', '4c Air Quality → Air');
ok(W.thumbnailTitle('Water Quality') === 'QUALITY-of-LIFE Weekly Report : Water', '4d Water Quality → Water');
ok(topics.filter((t) => !/Air Quality|Water Quality/.test(t)).every((t) => W.thumbnailTitle(t) === 'QUALITY-of-LIFE Weekly Report : ' + t), '4e every other topic uses its category name');
ok(W._fp({ a: 1, b: [2] }) === W._fp({ b: [2], a: 1 }) && W._fp({ a: 1 }) !== W._fp({ a: 2 }), '4f the approval fingerprint ignores key order and sees value changes');

// 5. Tab 17 is untouched on this branch
let base = null;
try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* none */ }
if (!base) console.log('SKIP — 5 origin/main is not in this checkout, so Tab 17 cannot be compared here');
else {
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).split('\n').filter(Boolean);
  ok(!changed.some((f) => /^lib\/acq-impact-|^docs\/impact-|^test\/impact/.test(f)), '5 no Tab 17 file differs from origin/main (' + changed.length + ' files changed)');
}

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
